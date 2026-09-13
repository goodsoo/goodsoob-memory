// Google Calendar OAuth (Desktop loopback + PKCE) + Calendar API transport.
//
// 모든 Calendar API 호출은 이 Rust 모듈의 `gcal_request` command 를 거친다.
// webview fetch 는 (1) Calendar API CORS 비우호 (2) bearer 토큰 JS 노출 때문에 회피
// — bearer 는 Rust 안에서만 산다. refresh token 은 macOS keychain(keyring), access
// token 은 메모리(GcalState) 에만.
//
// client secret 은 소스/repo 에 안 박는다: 빌드 시 `GCAL_CLIENT_SECRET` 환경변수가
// option_env! 로 baked, dev 는 런타임 env 로 fallback. 데스크탑 OAuth secret 은
// Google 이 "비밀 아님"으로 취급(PKCE 가 실제 보안) 하지만, repo 노출은 피한다.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::State;

const CLIENT_ID: &str =
  "315367283244-dhffmndel6htqgrflvt27d9gjis78uee.apps.googleusercontent.com";
// app 이 만든 캘린더만 접근 — 개인 캘린더 구조적 차단 (전용 goodsoob 캘린더 모델).
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.app.created";
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE: &str = "https://www.googleapis.com/calendar/v3";
const KEYRING_SERVICE: &str = "com.goodsoob.goodsoob-work.gcal";
const KEYRING_ACCOUNT: &str = "refresh_token";
// access token 만료 직전 갱신 (clock skew + 호출 지연 여유).
const EXPIRY_SKEW: Duration = Duration::from_secs(60);
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);

fn client_secret() -> Option<String> {
  option_env!("GCAL_CLIENT_SECRET")
    .map(|s| s.to_string())
    .or_else(|| std::env::var("GCAL_CLIENT_SECRET").ok())
    .filter(|s| !s.is_empty())
}

// ─── 에러 — TS 가 분기할 수 있게 tagged 직렬화 ──────────────────────────────
// Http 의 status 로 TS 가 404(캘린더 삭제)·410(syncToken 만료) 를 분류한다.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum GcalError {
  // GCAL_CLIENT_SECRET 미설정 — 빌드/실행 환경 문제.
  NotConfigured(String),
  // keyring 에 refresh token 없음 — 연동 안 됨.
  NotLinked,
  // refresh 가 invalid_grant — 재인증 필요. 일정을 조용히 떨구지 않음.
  AuthExpired,
  // Calendar API HTTP 에러 — TS 가 status 로 404/410 분기.
  Http { status: u16, body: String },
  Network(String),
  Internal(String),
}

// ─── 런타임 상태 (access token 메모리 캐시 + 공유 HTTP 클라이언트) ──────────
pub struct GcalState {
  http: reqwest::Client,
  inner: Mutex<Runtime>,
}

#[derive(Default)]
struct Runtime {
  access_token: Option<String>,
  expires_at: Option<SystemTime>,
}

impl GcalState {
  pub fn new() -> Self {
    GcalState {
      http: reqwest::Client::new(),
      inner: Mutex::new(Runtime::default()),
    }
  }
}

// ─── keyring (refresh token 영구 저장) ──────────────────────────────────────
fn keyring_entry() -> Result<keyring::Entry, GcalError> {
  keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
    .map_err(|e| GcalError::Internal(format!("keyring 초기화 실패: {e}")))
}

fn load_refresh_token() -> Option<String> {
  keyring_entry().ok()?.get_password().ok()
}

fn store_refresh_token(token: &str) -> Result<(), GcalError> {
  keyring_entry()?
    .set_password(token)
    .map_err(|e| GcalError::Internal(format!("refresh token 저장 실패: {e}")))
}

fn clear_refresh_token() {
  if let Ok(entry) = keyring_entry() {
    let _ = entry.delete_credential();
  }
}

// ─── PKCE ────────────────────────────────────────────────────────────────────
fn random_token(len: usize) -> String {
  use rand::distributions::Alphanumeric;
  use rand::Rng;
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(len)
    .map(char::from)
    .collect()
}

fn challenge_s256(verifier: &str) -> String {
  use base64::Engine;
  use sha2::{Digest, Sha256};
  let digest = Sha256::digest(verifier.as_bytes());
  base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

// ─── 토큰 응답 ─────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct TokenResponse {
  access_token: String,
  #[serde(default)]
  expires_in: Option<u64>,
  #[serde(default)]
  refresh_token: Option<String>,
}

fn set_access(state: &GcalState, access_token: String, expires_in: Option<u64>) {
  let mut rt = state.inner.lock().unwrap();
  rt.access_token = Some(access_token);
  // 만료 EXPIRY_SKEW 초 전에 미리 갱신하도록 당겨둠.
  rt.expires_at = expires_in.map(|secs| {
    SystemTime::now() + Duration::from_secs(secs).saturating_sub(EXPIRY_SKEW)
  });
}

fn cached_access(state: &GcalState) -> Option<String> {
  let rt = state.inner.lock().unwrap();
  let token = rt.access_token.as_ref()?;
  match rt.expires_at {
    Some(exp) if SystemTime::now() < exp => Some(token.clone()),
    Some(_) => None, // 만료
    None => Some(token.clone()),
  }
}

// ─── 로컬 redirect 캡처 (loopback) ──────────────────────────────────────────
// 첫 연결의 GET 라인에서 query string 만 뽑아 채널로 보낸다. 한 번 받고 닫음.
fn read_query(stream: &mut std::net::TcpStream) -> Option<String> {
  let mut buf = [0u8; 2048];
  let n = stream.read(&mut buf).ok()?;
  let req = String::from_utf8_lossy(&buf[..n]);
  // "GET /?code=...&state=... HTTP/1.1"
  let line = req.lines().next()?;
  let path = line.split_whitespace().nth(1)?;
  let query = path.split_once('?').map(|(_, q)| q.to_string());
  query
}

fn write_done(stream: &mut std::net::TcpStream) {
  let html = "<html><head><meta charset=\"utf-8\"></head><body style=\"font-family:-apple-system,sans-serif;padding:48px;text-align:center\"><h2>연동 완료</h2><p>이 창을 닫고 앱으로 돌아가세요.</p></body></html>";
  let resp = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    html.len(),
    html
  );
  let _ = stream.write_all(resp.as_bytes());
  let _ = stream.flush();
}

fn parse_query(query: &str) -> HashMap<String, String> {
  url::form_urlencoded::parse(query.as_bytes())
    .into_owned()
    .collect()
}

// application/x-www-form-urlencoded 바디 (reqwest 0.13 의 .form() 은 feature-gated
// 라 직접 직렬화 — url crate 의 Serializer 로 안전 인코딩).
fn urlencoded(pairs: &[(&str, &str)]) -> String {
  let mut s = url::form_urlencoded::Serializer::new(String::new());
  for (k, v) in pairs {
    s.append_pair(k, v);
  }
  s.finish()
}

fn open_browser(url: &str) -> Result<(), GcalError> {
  #[cfg(target_os = "macos")]
  let program = "open";
  #[cfg(target_os = "linux")]
  let program = "xdg-open";
  #[cfg(target_os = "windows")]
  let program = "explorer";
  std::process::Command::new(program)
    .arg(url)
    .spawn()
    .map(|_| ())
    .map_err(|e| GcalError::Internal(format!("브라우저 실행 실패: {e}")))
}

// ─── 토큰 교환 / 갱신 ───────────────────────────────────────────────────────
async fn exchange_code(
  http: &reqwest::Client,
  code: &str,
  verifier: &str,
  redirect_uri: &str,
  secret: &str,
) -> Result<TokenResponse, GcalError> {
  let resp = http
    .post(TOKEN_ENDPOINT)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(urlencoded(&[
      ("code", code),
      ("client_id", CLIENT_ID),
      ("client_secret", secret),
      ("redirect_uri", redirect_uri),
      ("grant_type", "authorization_code"),
      ("code_verifier", verifier),
    ]))
    .send()
    .await
    .map_err(|e| GcalError::Network(format!("토큰 교환 요청 실패: {e}")))?;
  let status = resp.status();
  if !status.is_success() {
    let body = resp.text().await.unwrap_or_default();
    return Err(GcalError::Http { status: status.as_u16(), body });
  }
  resp
    .json::<TokenResponse>()
    .await
    .map_err(|e| GcalError::Internal(format!("토큰 응답 파싱 실패: {e}")))
}

async fn refresh_access(state: &GcalState, secret: &str) -> Result<String, GcalError> {
  let refresh = load_refresh_token().ok_or(GcalError::NotLinked)?;
  let resp = state
    .http
    .post(TOKEN_ENDPOINT)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(urlencoded(&[
      ("client_id", CLIENT_ID),
      ("client_secret", secret),
      ("refresh_token", refresh.as_str()),
      ("grant_type", "refresh_token"),
    ]))
    .send()
    .await
    .map_err(|e| GcalError::Network(format!("토큰 갱신 요청 실패: {e}")))?;
  let status = resp.status();
  if !status.is_success() {
    let body = resp.text().await.unwrap_or_default();
    // refresh token 폐기/만료 → 재인증 필요. keyring 정리.
    if body.contains("invalid_grant") {
      clear_refresh_token();
      return Err(GcalError::AuthExpired);
    }
    return Err(GcalError::Http { status: status.as_u16(), body });
  }
  let token: TokenResponse = resp
    .json()
    .await
    .map_err(|e| GcalError::Internal(format!("갱신 응답 파싱 실패: {e}")))?;
  let access = token.access_token.clone();
  set_access(state, token.access_token, token.expires_in);
  Ok(access)
}

async fn ensure_access(state: &GcalState, secret: &str) -> Result<String, GcalError> {
  if let Some(token) = cached_access(state) {
    return Ok(token);
  }
  refresh_access(state, secret).await
}

async fn do_request(
  http: &reqwest::Client,
  token: &str,
  method: &str,
  path: &str,
  body: &Option<serde_json::Value>,
) -> Result<reqwest::Response, GcalError> {
  let url = format!("{CALENDAR_BASE}{path}");
  let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
    .map_err(|e| GcalError::Internal(format!("잘못된 method {method}: {e}")))?;
  let mut req = http.request(m, &url).bearer_auth(token);
  if let Some(b) = body {
    req = req.json(b);
  }
  req
    .send()
    .await
    .map_err(|e| GcalError::Network(format!("Calendar API 요청 실패: {e}")))
}

async fn finish(resp: reqwest::Response) -> Result<serde_json::Value, GcalError> {
  let status = resp.status();
  if !status.is_success() {
    let body = resp.text().await.unwrap_or_default();
    return Err(GcalError::Http { status: status.as_u16(), body });
  }
  // 204 No Content (events.delete 등) → null.
  if status.as_u16() == 204 {
    return Ok(serde_json::Value::Null);
  }
  let text = resp.text().await.unwrap_or_default();
  if text.is_empty() {
    return Ok(serde_json::Value::Null);
  }
  serde_json::from_str(&text)
    .map_err(|e| GcalError::Internal(format!("응답 파싱 실패: {e}")))
}

// ─── commands ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AuthStatus {
  // keyring 에 refresh token 있음 = 연동됨.
  linked: bool,
  // GCAL_CLIENT_SECRET 주입됨 = OAuth 가능.
  configured: bool,
}

#[tauri::command]
pub fn gcal_auth_status() -> AuthStatus {
  AuthStatus {
    linked: load_refresh_token().is_some(),
    configured: client_secret().is_some(),
  }
}

#[tauri::command]
pub fn gcal_disconnect(state: State<'_, GcalState>) {
  clear_refresh_token();
  let mut rt = state.inner.lock().unwrap();
  rt.access_token = None;
  rt.expires_at = None;
}

#[tauri::command]
pub async fn gcal_auth_start(state: State<'_, GcalState>) -> Result<(), GcalError> {
  let secret = client_secret().ok_or_else(|| {
    GcalError::NotConfigured(
      "GCAL_CLIENT_SECRET 환경변수가 없습니다. 빌드/실행 환경에 설정하세요.".into(),
    )
  })?;

  let verifier = random_token(64);
  let challenge = challenge_s256(&verifier);
  let expected_state = random_token(32);

  // loopback 바인딩 (ephemeral 포트).
  let listener = std::net::TcpListener::bind("127.0.0.1:0")
    .map_err(|e| GcalError::Internal(format!("loopback 바인딩 실패: {e}")))?;
  let port = listener
    .local_addr()
    .map_err(|e| GcalError::Internal(format!("포트 조회 실패: {e}")))?
    .port();
  let redirect_uri = format!("http://127.0.0.1:{port}");

  let (tx, rx) = std::sync::mpsc::channel::<String>();
  std::thread::spawn(move || {
    if let Ok((mut stream, _)) = listener.accept() {
      let query = read_query(&mut stream).unwrap_or_default();
      write_done(&mut stream);
      let _ = tx.send(query);
    }
  });

  // 인증 URL. access_type=offline + prompt=consent 로 refresh token 보장.
  let auth_url = url::Url::parse_with_params(
    AUTH_ENDPOINT,
    &[
      ("client_id", CLIENT_ID),
      ("redirect_uri", redirect_uri.as_str()),
      ("response_type", "code"),
      ("scope", SCOPE),
      ("code_challenge", challenge.as_str()),
      ("code_challenge_method", "S256"),
      ("state", expected_state.as_str()),
      ("access_type", "offline"),
      ("prompt", "consent"),
    ],
  )
  .map_err(|e| GcalError::Internal(format!("인증 URL 생성 실패: {e}")))?;

  open_browser(auth_url.as_str())?;

  // redirect 대기 (blocking) — blocking 풀에서.
  let query = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(AUTH_TIMEOUT))
    .await
    .map_err(|e| GcalError::Internal(format!("대기 태스크 실패: {e}")))?
    .map_err(|_| GcalError::Internal("인증 시간이 초과됐습니다. 다시 시도하세요.".into()))?;

  let params = parse_query(&query);
  if params.get("state").map(String::as_str) != Some(expected_state.as_str()) {
    return Err(GcalError::Internal(
      "state 불일치 — 보안을 위해 인증을 중단했습니다. 다시 시도하세요.".into(),
    ));
  }
  let code = params.get("code").ok_or_else(|| {
    let err = params.get("error").cloned().unwrap_or_else(|| "unknown".into());
    GcalError::Internal(format!("인증 코드를 받지 못했습니다: {err}"))
  })?;

  let token = exchange_code(&state.http, code, &verifier, &redirect_uri, &secret).await?;
  let refresh = token.refresh_token.clone().ok_or_else(|| {
    GcalError::Internal(
      "refresh token 이 발급되지 않았습니다. consent screen 설정을 확인하세요.".into(),
    )
  })?;
  store_refresh_token(&refresh)?;
  set_access(&state, token.access_token, token.expires_in);
  Ok(())
}

// 모든 Calendar API 호출의 단일 진입점. 401 → 강제 refresh → 1회 재시도.
#[tauri::command]
pub async fn gcal_request(
  state: State<'_, GcalState>,
  method: String,
  path: String,
  body: Option<serde_json::Value>,
) -> Result<serde_json::Value, GcalError> {
  let secret = client_secret().ok_or_else(|| {
    GcalError::NotConfigured("GCAL_CLIENT_SECRET 환경변수가 없습니다.".into())
  })?;
  let token = ensure_access(&state, &secret).await?;
  let resp = do_request(&state.http, &token, &method, &path, &body).await?;
  if resp.status().as_u16() == 401 {
    // 캐시 토큰이 서버에서 무효 → 강제 갱신 후 1회 재시도.
    let token = refresh_access(&state, &secret).await?;
    let resp = do_request(&state.http, &token, &method, &path, &body).await?;
    return finish(resp).await;
  }
  finish(resp).await
}
