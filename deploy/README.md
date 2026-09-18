# deploy — 로컬 서버 상주 (launchd)

V0.8 PWA 전환. Pro 맥이 정본 brain 을 소유한 Bun 서버(`server/index.ts`, 포트 7080)를 launchd 로 상주시킨다. growth(7060)·tower(7071) 와 동일 패턴 (`RunAtLoad`+`KeepAlive`, 로그인 시 자동 기동, 크래시 자동 재시작).

## ⚠️ 활성화 전 선결조건 (T0)

`launchctl load` 하기 **전에** 반드시:

1. **T0 완료** — `~/brain/.git`(467MB) 을 iCloud 밖 로컬로 분리 + `git gc`(loose 2445 → pack) + `gbrain-sync` 데몬과 앱 서버 writer 관계 정리. 안 하면 iCloud+git mtime-churn/부분sync 손상 재현.
2. plist 의 `VAULT_DIR` placeholder(`__SET_TO_BRAIN_PATH_AFTER_T0__`) 를 실제 brain 경로로 교체. 서버는 존재하지 않는 경로면 fast-fail 하므로, T0 전 실수로 load 해도 brain 을 건드리지 않는다.
3. `bun run build` 로 `dist/` 생성 (서버가 정적 서빙).

## 설치 (Pro 맥, T0 후)

```bash
cp deploy/com.goodsoob.memory.plist ~/Library/LaunchAgents/
# VAULT_DIR 를 실제 경로로 편집한 뒤:
launchctl load ~/Library/LaunchAgents/com.goodsoob.memory.plist
```

## air 맥 fallback (T9 — 코드 완료, 물리 검증 대기)

air 는 평소 Pro 서버에 브라우저로 접속(자기 서버 안 띄움). **Pro 다운 시에만** air 서버를 올려 단일 writer 로 fallback합니다. Pro 복귀 시 iCloud 가 md 를 재일치합니다.

### 구성 파일

| 파일 | 역할 |
|---|---|
| `deploy/air-fallback.sh` | Pro 헬스체크 후 조건부 기동 wrapper |
| `deploy/com.goodsoob.memory.air.plist` | air 맥 launchd 설정 (평소 unload) |

### 설치 (air 맥)

```bash
# 1. plist 내 PRO_HEALTH_URL 과 VAULT_DIR 을 실제 값으로 편집
#    PRO_HEALTH_URL 예시:
#      tailscale 사용: http://<pro-tailscale-ip>:7080/api/health
#      LAN 직접:       http://<pro-lan-ip>:7080/api/health
#    VAULT_DIR: Pro 와 동일한 brain 경로 (iCloud 공유)

# 2. air LaunchAgents 에 복사 (Pro plist 는 절대 넣지 말 것 — Label 충돌)
cp deploy/com.goodsoob.memory.air.plist ~/Library/LaunchAgents/com.goodsoob.memory.plist
```

### 운영

```bash
# Pro 다운 확인 후 air 서버 올리기
launchctl load ~/Library/LaunchAgents/com.goodsoob.memory.plist

# Pro 복귀 후 air 서버 내리기
launchctl unload ~/Library/LaunchAgents/com.goodsoob.memory.plist
```

### 헬스체크 동작 (`air-fallback.sh`)

1. `PRO_HEALTH_URL` 설정 시: `curl --max-time 3` 으로 Pro `GET /api/health` 확인.
   - **200 응답(Pro 살아있음)** → "air fallback 거부 (이중 writer 방지)" 로그 + 종료(서버 미기동).
   - **실패/타임아웃(Pro 다운)** → 로그 후 서버 기동.
2. `PRO_HEALTH_URL` 미설정 시: 헬스체크 없이 즉시 기동(수동 fallback 모드).

### `/api/health` 엔드포인트

`GET /api/health` — 인증 없음. 응답 예시:

```json
{ "ok": true, "vaultDir": "/path/to/brain", "pid": 12345, "uptime": 3600.1 }
```

air 가 Pro 생사 판정에 사용합니다. 외부 모니터링에도 활용 가능합니다.

### 남은 항목 (물리 검증 대기)

- 실제 두 맥 E2E 검증 (tailscale/LAN 연결 상태에서 fallback 동작 확인).
- `com.goodsoob.memory.air.plist` 의 `PRO_HEALTH_URL` · `VAULT_DIR` 실제 값 기입.
- KeepAlive + 헬스체크 조합 시 Pro 복귀 후 air 자동 종료 여부 확인 (현재: 수동 unload 필요).

## 외부 노출

tailscale serve 로 폰에서 접속(brain 은 극도로 사적 → 공개 도메인 노출 X, tailnet 소속 = 인증). growth 는 로컬전용, tower 는 cloudflared — 우리는 tailscale serve 로 신규 채택. 활성화는 별도 (defer).
