# goodsoob-work — Claude Code 컨텍스트

본인 전용 시간축 통합 업무관리 데스크탑 앱 (Tauri). 1인 본인 사용 사이드 프로젝트 (빌더 모드). **V0.6 부터 로컬 md 파일 vault 백엔드** — 로컬 마크다운 파일 기반.

> **마크다운 호환 방침** (2026-06-14): 사용자는 옵시디안(Obsidian) 앱을 쓰지 않는다. **옵시디안 호환은 설계 제약이 아니다.** vault 저장 포맷/frontmatter/파일명을 정할 때 기준은 (1) 표준 마크다운으로 깔끔하게 읽히는가, (2) 앱 동작에 맞는가. 아래 로드맵·결정에 남은 "옵시디안 …" 표현은 당시 설계 출처를 기록한 history일 뿐 현재 구속력 없음.

## 프로젝트 진실 source

- **기획안**: `goodsoob-work-plan.md`
- **V0.6 Vault 마이그레이션 design doc**: `V0.6-vault-design.md` (프로젝트 루트). eng-review 통과.
- **V0.5 Design doc** (이전): `~/.gstack/projects/goodsoob-work/ham-no-git-design-20260506-161246.md`
- **Test plan**: `~/.gstack/projects/goodsoob-work/ham-no-git-eng-review-test-plan-20260506-170527.md`

해당 파일을 읽고 일하는 게 source of truth. 이 파일은 빠른 컨텍스트만.

## 로드맵

- ✅ V0.0~V0.5 — 기본 기능 완료 (메모 CRUD, AI 요약, 일기, Todo, 캘린더)
- ✅ V0.5.1 — 데스크탑 3-pane 레이아웃 + 캘린더 리라이트 + 디자인 토큰 + 테마
- ✅ V0.5.2 — 메모장 본문/회의 내용/요약 3-탭 + transcript 필드 + 편집/보기 토글 + 글로벌 툴팁
- ✅ V0.5.3 — 캘린더 첫 진입 버그 fix + 메모 history 메모별·탭별 분리 + 진입 자동 선택 + 페이지 전환 시 보존
- ✅ V0.6 — **Vault 마이그레이션**. Supabase + Auth 완전 제거, 로컬 md 파일 vault 백엔드, Tauri 데스크탑 전용 (PWA 빌드 폐기), AI 자동 요약 제거하고 "Claude 프롬프트 복사" 헬퍼 추가. design doc: `V0.6-vault-design.md`
- ✅ V0.7 — **"내 작업" 탭**. gh CLI 위임으로 본인 GitHub PR 자동 수집 → vault `portfolio/` 폴더에 카드 누적. design doc: `~/.gstack/projects/goodsoob-work/ham-main-design-20260518-105501.md` (v2.3, eng + design review CLEAR). repo → project 자동 분류 + github_pr_id 기반 rename 자동 감지 + legacy 카드 (PR 안 만든 commit) 도 schema 지원.
- ✅ V0.7.1 — **vault 데이터 손실 race + identity 모델 보강**. dogfood 중 실제 사라진 메모 추적 — 다섯 root cause (`adapter.write` 동시 `.tmp` 충돌 / `useUpdateMeeting` 병렬 mutation rename race / Enter→blur 중복 발사 / `vault watcher` event type 매칭 실패 / 옛 path 재사용 시 cache 침범) 일괄 fix (PR #11). **frontmatter `id: <uuid>`** 영구 식별자 도입 (옵시디안 community `obsidian-unique-identifiers` 표준), client cache key (React Query / `HISTORY_CACHE` / URL hash) 모두 uid 기반 통일. **Title-as-Filename**: 파일명 = `meetings/{title}.md` only (frontmatter title 제거, date 빠짐 → 순수 frontmatter optional). title 변경 = pure disk rename → inode 유지 (옵시디안 default 모델 동일). 제목 충돌 시 자동 -2 X → `TitleConflictError` toast + focus 유지 + ESC revert. 금지문자 입력은 commit 시점 검사 + toast.
- ✅ V0.7.2 — **안정성 race 묶음 + 사이드바 정렬** (PR #15). useMeeting 의 list-loaded gate (race 차단), readFullMeeting throw + React Query retry (iCloud sync 중 stuck 차단), useStateHistory `valueRef` 동기 갱신 (set+immediate flush race 차단), docHistory cacheKey path → uid (title rename 시 history 유지), `isSyncNoiseFile` (iCloud/Dropbox 충돌·placeholder·dotfile 스캔 제외), Tauri `assetProtocol` enable (portfolio 스크린샷 로드), 사이드바 정렬 popover (최신순/오래된순/이름순, 키 우선순위 date→time→mtime).
- ✅ V0.7.3 — **요약 흐름 모달화 + 본문과 동일 에디터로 통합** (PR #53). `Meeting.summary` 데이터 모델을 array 3개 (`discussion_items`/`decisions`/`action_items`) → **단일 마크다운 string** 으로 통일 (변환 함수 `buildSummaryBody`/`extractH2List`/`buildH2List` 제거, `.summary.md` 사이드카는 raw markdown 그대로 — 옵시디안에서 자연스러운 노트로 보임). 요약 탭 UI 도 본문 탭과 동일하게 `SourceBodyEditor` (편집) ↔ `MarkdownView` (보기) — 옛 callout 3개 전용 렌더 폐기. "요약" 액션은 `SummaryModal` (Claude 프롬프트 복사 → 응답 paste) 로 모달화. 잔재 "회의" 용어도 메모/음성 기록 라벨로 정리.
- ✅ V0.7.4 — **앱 단순화 착수 1: "오늘" 대시보드 + 기본 진입 변경** (PR #78, design: 루트 `SIMPLIFY.md`). 기본 진입을 캘린더 그리드 → "오늘" 대시보드로. 메인 = 오늘 고정 4블록(오늘 일정 / 오늘·밀린 할 일 / 오늘의 루틴 / 이어서 쓸 노트, 시간축 객체와 1:1), 사이드바 = 다가오는 일정 아젠다(`TodayAgendaPanel`, 캘린더 그리드의 "날짜 훑기" 역할 대체). 탭 순서 오늘/메모장/할일/캘린더/포트폴리오 (캘린더 강등). 곁다리로 path traversal 가드 substring `..` 오탐으로 마침표 끝 제목 노트가 사이드바에서 사라지던 data loss 버그 fix (PR #77, 세그먼트 단위 검사 + `adapter.test.ts`).
- ✅ V0.7.5 — **캘린더 탭 폐기 → "오늘" 탭이 흡수** (PR #79). 캘린더 탭/`CalendarPage`/`MonthGrid`/`lib/calendar/spans` 삭제, 탭 4개로 (오늘/메모장/할일/포트폴리오, Cmd+1~4). 날짜 훑기·일기 진입은 "오늘" 사이드바(`TodayAgendaPanel`)가 흡수 — 1년 창 + 헤더 `[<][오늘][>]` 연도 네비, 일정만 풀 행·할일/노트/일기는 아이콘+숫자 배지, sticky 월 헤더, 날짜·시각 좌측 거터 통일. 일기 오버레이는 App 레벨(`#today` 메인 블록 + 사이드바 날짜 클릭 + QuickSwitcher 공용). 곁다리로 캡쳐 창 탐색을 제목 매칭 → 최전면 앱 창으로 (`scripts/find-window.swift`).
- 🟡 V0.8 — **PWA local-first 전환** (브랜치 `feat/pwa-local-first`, design: `docs/designs/pwa-local-first-migration.md`). Tauri 데스크탑 셸 폐기 → **브라우저/PWA + 로컬 Bun 서버 단일 아키텍처**. **완료**: T0 git gc(.git churn 해소) / T1~T4 Bun 서버·HTTP adapter·PWA 셸·launchd 상주(localhost:7080) / **T8 Tauri 전면 삭제** — `src-tauri/` 통삭 + `@tauri-apps` 의존·스크립트 제거 + isTauri 분기 서버 경로로 통일 + vault-add Dialog 제거(단일 vault) + export→브라우저 download + `--header-h` web 높이(3.5rem) 단일화 / **gcal 통삭** (Google Calendar 는 tower 로 이전, 이 앱에서 제거 — 로컬 일정 schedules 는 유지) / portfolio **scanAll** batch (카드 스캔 985왕복 → 1회) / **T5** capture outbox(IndexedDB 오프라인 쓰기 큐 + reconnect flush) · **T6** 읽기 캐시(최근 50 LRU) + 오프라인 placeholder · **T7** 데이터 유실 스위트(27 테스트) / **auto-backup·portfolio auto-sync 서버 경유 활성화** (`isTauri` 감지 완전 은퇴 = `isTauri.ts` 삭제, 자동 트리거 실패는 silent·수동은 피드백 유지) / **T9 코드** air fallback 헬스체크 가드(`deploy/air-fallback.sh` — `PRO_HEALTH_URL` 로 Pro 생사 확인 후 다운일 때만 기동, 이중 writer 방지) + `deploy/com.goodsoob.memory.air.plist` + `GET /api/health`(server/index.ts:203). **미완(물리·infra 의존, defer)**: T9 두 맥 실기 E2E + `PRO_HEALTH_URL` 실값 · iOS 실기 오프라인/eviction E2E · tailscale serve 활성화 + 폰 PWA HTTPS 설치 · main 머지(물리 검증 후 `/takeoff`).
- 🟡 V0.7.x 후보 — 회사 outbound 차단 시 auto-sync off 옵션, "Claude 응답 paste → 자동 callout" 헬퍼. SIMPLIFY 후속 착수 (할일/일정/루틴 모델 분리 + 카테고리 제거 + lazy migration 등) — 루트 `SIMPLIFY.md` 참조.
- 🟡 후속 — 녹음 파일 직접 업로드 → 자동 STT

## 핵심 결정 (review 통과됨)

- **Server state**: TanStack Query 일관 사용. 모든 fetch는 `useMeetings` 같은 훅 패턴. `src/api/{meetings,journals,todos,schedules}.ts` 가 vault adapter 캡슐화 + `src/hooks/use*.ts` 가 query/mutation 정의. `useUpdateMeeting` 은 optimistic update (인라인 편집 즉시 반영). **메모 식별자**: meta 의 `id` = 현재 file path (rename 시 변경), `uid` = frontmatter 의 영구 uuid (V0.7.1 이후). 모든 client cache key (queryKey, `HISTORY_CACHE`, URL hash, hook signature) 는 uid 기반. `useUpdateMeeting(uid)` 가 mutationFn 시점에 list cache 에서 현재 path lookup. `scope: { id: \`meeting:${uid}\` }` 로 같은 메모 mutation 직렬화.
- **vault adapter 의 동시성** (V0.7.1): `adapter.write` 가 per-path mutex + 고유 tmp 이름 (`${abs}.${random}.tmp`). 동시 같은-path write 가 공유 tmp 를 충돌시켜 파일이 진짜 삭제되던 race 차단. atomic write (tmp → rename) 유지 — iCloud partial sync 위험 회피.
- **vault watcher** (V0.7.1): Tauri v2 plugin-fs 의 event `type` 이 object (notify-rs EventKind 직렬화 — `{create:{kind:"file"}}` 등). object key 기준 분기 + `modify::metadata` 노이즈 skip + macOS Finder `.Trash` rename 을 deleted 로 normalize. 외부 변경 즉시 사이드바 반영.
- **회의록 폼 상태**: `useStateHistory` 1개 stack 으로 통합 — `DocSnapshot = { body, transcript, summary, meta(date+time+attendees) }`. 옵시디안/notion 처럼 메모 전체가 하나의 timeline (focus 무관 마지막 변경 undo). cacheKey=`${uid}:doc` (V0.7.2 path → uid — title rename 시 history 유지). commitMs=1000 (본문 typing 1초 wait). 명시 commit (meta blur/Enter, summary 모달 적용) 은 setDoc(source, next, immediate=true) → flush 로 즉시 entry. body/transcript 안에서 줄바꿈 (`\n` count 증가) 감지하면 flush 로 줄 boundary. lastSourceRef 추적해 input 별 entry 분리. **useStateHistory race fix** (V0.7.2): `set` 안에서 `valueRef.current` 동기 갱신, `flush` 가 그걸 사용 — 같은 turn 의 `set(next) → flush()` 에서 useCallback closure 의 stale value 가 history 에 박혀 undo 가 안 먹던 race 차단. **제목**은 별도 — history 미참여, native input undo + commitTitle 가 직접 mutation (rename + 충돌 처리). title input 은 useState draft + focus 검사 (사용자 typing 중 server data 안 덮어씀).
- **일기/캘린더 자동 저장**: `useDebouncedSave` (queue coalescing) — 일기 본문 등 텍스트 단일 필드용. 회의록은 위 useStateHistory가 대체.
- **요약 AI 흐름** (V0.6 + V0.7.3): Supabase Edge Function 자동 요약 폐기 → `SummaryModal` 두 탭 — **[자동 요약]** (`runClaudeStream` 으로 본인 머신 `claude` CLI 스트리밍 호출 → 진행률 표시 → 응답 적용) + **[직접 붙여넣기]** (프롬프트 복사 → 외부 Claude.ai → 응답 paste). 둘 다 `src/lib/clipboardPrompt.ts` 의 `buildClaudePrompt(input, templateId)` 로 프롬프트 생성. 사용자 복사/응답 → `summary` string 통째 적용 (파싱 X). 옛 array 3분리 (`discussion_items`/`decisions`/`action_items`) 와 `claude-haiku` Edge Function 호출은 src 에 더 이상 없음.
- **요약 템플릿** (V0.7.x): 출력 형식만 상황별로 갈아끼우는 코드 프리셋. `clipboardPrompt.ts` 의 `SUMMARY_TEMPLATES` 3개 — `meeting` (회의록, default: `### 논의 사항`/`### 결정 사항`(합의·확정만)/`### 액션 아이템`(`[담당자] 할 일 — 기한`)) / `work` (작업 요약: `### 한 일`/`### 결과`/`### 다음 할 일`) / `lecture` (세미나·강의: `### 핵심 개념`/`### 주요 내용`/`### 적용점`). 모든 템플릿 마지막에 `### 기타` — 본 흐름과 무관하지만 알아둘 내용 모음 (빈 섹션 생략 규칙으로 없으면 자동 omit, 공유 시 그 섹션만 제외). meeting 의 인트로(`다음 메모를 정리해주세요.`)는 기존과 동일 (옛 테스트 보존). `buildClaudePrompt(input, templateId='meeting')` — default 라 기존 호출/테스트 무손상. 입력 파이프라인(메타/메모/음성 기록 합성)은 공통이라 참석자·음성기록 일부 없는 입력에도 빈 섹션 없이 적응. 템플릿마다 `intro`(meeting 만 "다음 메모를", 나머지 "다음 내용을")+`format`+`rule`. `SummaryModal` 탭 nav 아래 칩 row (자동·붙여넣기 두 탭 공통, 활성 칩은 `--bg-surface-hover`+`--text-primary`). 선택은 localStorage 전역 last-used (`goodsoob:summaryTemplate`, 메모별 X — v1). 칩 변경 시 자동 요약 suggestion·진행 표시 reset (형식 달라져 stale 방지), requesting 중엔 disable.
- **요약 AI 입력 source** (V0.5.2): 본문(`content`, 회의 중 직접 적은 정리 노트) + 음성 기록(`transcript`, 녹음의 외부 STT 변환 결과). 본문 우선, transcript는 디테일 보조. 충돌 시 본문 우선. 한쪽만 있어도 동작. 둘 다 비면 요약 액션 클릭 시 안내 토스트.
- **테스트**: Vitest. `src/**/*.test.ts(x)` ~30개 파일 (vault parser/scan/watcher/conflict/tasks, markdown 계열, dates, gcal mapping/reconcile/state/transport, portfolio gh/imageImport, clipboardPrompt, findMatches, useStateHistory, MarkdownView 등). Edge Function smoke 는 V0.6 Supabase 제거로 폐기. UI 회귀는 본인이 매일 사용으로 발견.
- **디자인 토큰**: 시맨틱 CSS custom property 기반 (18개 토큰). `DESIGN.md` 참조. 컴포넌트에서 `style={{ color: "var(--text-primary)" }}` 패턴. Tailwind `dark:` 색상 접두사 사용 금지.
- **테마**: `useTheme` hook. 라이트/다크 2단계 토글. 첫 방문 시 OS 설정 → localStorage 저장. `.dark` class 기반 (`@custom-variant dark`).
- **레이아웃 (데스크탑)**: 3-pane. `ActivityBar` (48px 아이콘) + `SidePanel` (288px, 탭별 내용) + Main. 모바일: 하단 탭 + 단일 컬럼.
- **"회의록" → "메모장"**: UI 전체 리네이밍 완료. 내부 코드는 `meetings` 유지.
- **메모장 에디터** (V0.5.2): 제목(3xl) → 메타데이터(인라인) → 3-탭 [본문 / 회의 내용 / 요약]. 탭 row sticky(`top: 2.5rem`). 우측 액션(편집/보기 토글, 마크다운 복사, 삭제) compact 아이콘. 하단에 액션 X.
  - **본문 탭**: `SourceBodyEditor` (편집, 마크다운 source) ↔ `MarkdownView` (보기). 토글은 `useViewMode` (localStorage persist). 편집 모드 textarea 왼쪽에 line gutter — `inferLineKind`가 줄별 마크다운 종류 표시 (제목/목록/인용/코드/Setext heading/들여쓰기 단계 등 + 이전 컨텍스트로 "이어짐" 추론). `wrap="off"` + 세로 페이지 스크롤.
  - **회의 내용 탭** (`transcript`): 편집 = raw textarea + 파일 업로드 (`.txt/.md/.vtt/.srt`, 기존 내용 뒤에 이어붙임). 보기 = `TranscriptView` 읽기 전용 평문 (pre-wrap, 마크다운 렌더 X — STT 줄바꿈 보존) + 참석자별 색상 칩 (`meta.attendees` ", " join 파싱, 1글자 이름은 오버매치 회피로 제외, 긴 이름 우선 매칭. 색은 **적힌 순서대로** `--speaker-0..9` 토큰 i%10 배정 → 한 회의 안 10명까지 색 안 겹침. 매칭 정렬(길이순)과 색 배정 순서는 분리) + mm:ss·h:mm:ss 타임스탬프 하이라이트 (인라인 코드 칩과 동일 `--bg-surface-hover`/`--text-primary`, 단어 경계 가드). 이름·시간 한 토크나이저 (named group `name`/`time`) 로 분리. 본문·요약과 동일하게 편집/보기 토글 (ModeChip + Cmd+Shift+E) 공유.
  - **요약 탭** (V0.7.3): 본문 탭과 동일 모델 — `SourceBodyEditor` (편집, 마크다운 source) ↔ `MarkdownView` (보기). `summary` 는 단일 마크다운 string (옛 callout 3개 array 모델 폐기). 헤더 우측 "요약" 액션 → `SummaryModal` (메모·음성 기록 기반 Claude 프롬프트 복사 → AI 응답 paste, `applySummaryFromModal` 이 summary 통째 교체 = 단일 history entry, Cmd+Z 복원). 메모·음성 기록 둘 다 비면 클릭 시 안내 토스트 (aria-disabled). 요약 없을 땐 본문 중앙 `EmptyState` 로 CTA. MarkdownView 의 체크박스/액션 아이템 → todo 변환은 본문 탭과 공유.
  - **메모/탭 전환 동작** (V0.5.3): 메모 전환 시 `ACTIVE_TAB_CACHE` 모듈 Map 에서 그 메모의 마지막 탭으로 (없으면 본문). 페이지 전환(메모장 ↔ 캘린더 등) 후 돌아와도 메모 + 마지막 탭 + 4-stack history 모두 유지. 새로고침 시 모듈 cache 비워짐.
  - 단축키: Cmd/Ctrl+Z (docHistory undo/redo — focus 가 제목 input 이면 native input undo 통과), Cmd+1/2/3/4 페이지 탭 (Tauri only), Cmd+N 새 메모 (input/textarea 안에서도 동작 — 메모장 탭에서 활성, Tauri only), Cmd+Backspace/Delete 현재 메모 휴지통 이동 (input/textarea 밖에서만, confirm 1번, Tauri only), Cmd+↑/↓ 이전/다음 메모 (input/textarea 밖에서만, Tauri only), **Opt+Tab / Opt+Shift+Tab sub-tab cycle** (본문→음성기록→요약→본문, textarea/input 무관 — input 안 Tab=indent 는 SourceBodyEditor 가 `!e.altKey` 가드로 양보), **Cmd+Shift+E** 세 탭 모두 편집/보기 토글 (SourceBodyEditor 의 Cmd+E inline-code wrap 충돌 회피로 Shift 동반, viewMode 는 탭 공유). 음성 기록 보기 = 읽기 전용 평문 + 참석자 하이라이트. 헤더 우측 Eye/Pencil 아이콘 토글 버튼 + 본문 글자수 옆 ModeChip (아이콘 의미 = 다음 액션). 일기 (JournalOverlay) 의 편집/보기 토글도 동일 키 (Cmd+Shift+E) 로 통일. 옛 Q/W/E 단독키 + Opt+Q/W/E 는 한글 IME 오발화 + "메모 안에서 그 글자 입력 안 막힘" confusion 으로 제거.
- **캘린더 탭** (V0.7.5 폐기): `CalendarPage`(월 그리드)·`MonthGrid`·`lib/calendar/spans`·`CalendarDayPanel` 전부 삭제. 날짜 훑기·일기 진입은 "오늘" 탭 사이드바(`TodayAgendaPanel`)가 흡수 — 아래 "오늘 대시보드" 항목 참조. (gcal 동기화는 캘린더 탭과 무관하게 유지.)
- **할 일 카테고리**: `todos.category` (work/meeting). 사이드바 필터 (전체/업무/미팅/미분류). 일정(schedules)과 통합 표시.
- **라우팅**: URL hash 기반 (`#today` / `#meetings` / `#todos` / `#portfolio` / `#meeting-{uid}`). **빈 hash = 기본 진입 = `#today`**. 탭 순서 오늘/메모장/할일/포트폴리오 (Cmd+1~4, `readTabFromHash` 의 `TABS[0]` = today). 캘린더 탭은 V0.7.5 에서 폐기 — 옛 `#calendar` 는 `#today` 로 fallback. meeting id 는 V0.7.1 이후 uid (uuid). tab 전환 시 `selectedMeetingId` (= uid) 보존 — 메모장 ↔ 다른 탭 왕복해도 보던 메모 그대로. `hashchange` listener 는 hash 에 meeting uid 있을 때만 set, 다른 hash 일 땐 보존.
- **"오늘" 대시보드** (V0.7.4 신설 / V0.7.5 사이드바 확장, `#today`, Cmd+1, 기본 진입): `src/pages/TodayPage.tsx` (메인) + `src/components/today/TodayAgendaPanel.tsx` (사이드바). 메인은 **오늘 고정** 5블록 — 오늘 일정(`category==="schedule"` + 오늘, 다일 포함, 체크 없음) / 오늘·밀린 할 일(그 외 카테고리, 오늘 마감 + 지난 미완료, 밀린 건 빨강, 인라인 체크) / 오늘의 루틴(`useActiveRoutines`, 원형 체크) / 이어서 쓸 노트(최근 mtime 5개 + 새 노트) / 오늘 일기(미리보기 또는 쓰기 CTA → 일기 오버레이). 상단 할 일 빠른 추가 한 줄. **사이드바 = 세로 날짜 리스트** (V0.7.5, 폐기된 캘린더 탭의 날짜 훑기·일기 진입 흡수): 한 번에 **1년 창**(1.1~12.31, 빈 날 포함), 헤더 `{연도} [<][오늘][>]` 로 이전/다음 해 이동·올해+오늘 복귀. **일정만 풀 행**(시각+제목, 클릭=열기), 할일·노트·일기는 날짜 헤더 우측 **아이콘+숫자 배지**(신호만). 날짜("일 요일")는 일정 시각과 같은 좌측 거터 정렬, **sticky 월 헤더**(`--bg-surface-active` 밴드), 올해 창은 오늘로 자동 스크롤(데이터 도착 시 1회 보정, 이후 안 튐). **날짜 헤더 클릭 = 그날 일기 오버레이**(메인 "오늘 일기" + QuickSwitcher 와 공용, App 이 `journalDate` 소유). 기존 컴포넌트/훅 재사용(CheckboxButton/PageHeaderBar/useTasks/useActiveRoutines/JournalOverlay 등).
- **"내 작업" 탭** (V0.7, `#portfolio`, Cmd+4): `src/api/portfolio.ts` (vault 캡슐화) + `src/hooks/usePortfolio.ts` (TanStack Query + useGhSync) + `src/components/portfolio/*` (카드 그리드 + 사이드바 + dropzone + lightbox) + `src/pages/PortfolioPage.tsx`. **데이터 모델**: vault 안 `portfolio/{owner-repo-{number}}.md` flat 폴더 + `portfolio/projects.md` (프로젝트 그룹 + repos 매핑) + `portfolio/.synced.md` (마지막 sync 시각) + `portfolio/_attachments/{slug}/{before|after}-{n}.jpg` (스크린샷). **frontmatter**: `type: portfolio-work` + `github_pr_id` (영구 식별자) + github_* (read-only, sync 갱신) + project/included/category/impact_summary/screenshots/synced_at (본인 수정 + sync 보존). **sync**: `gh search prs --author @me is:merged --json id,...` 으로 본인 PR 전체 fetch → `gh pr view <url> --json mergedAt,changedFiles,...` enrich → upsert (id 매칭 rename 감지 + repo→project 자동 분류 + 본인 수정 보존). gh/claude 호출은 모두 `Command.create("bash", loginShellArgs(...))` = `bash -lc` (gh.ts 의 `LOGIN_SHELL_PROGRAM`/`loginShellArgs` single source). login 셸이라야 `~/.bash_profile`(nvm·`~/.local/bin`·brew) 가 PATH 에 들어옴 — Finder 실행 release `.app` 의 launchd 최소 PATH fix. 첫 sync 시 projects.md 자동 부트스트랩 (1 repo = 1 project, 텍스트 에디터에서 rename/merge 가능). 5초 background auto-sync + 사이드바 수동 트리거. 카드 자동 삭제 0 (repo 삭제되어도 평가 자료 보존). legacy 카드 (pr_number=0) 허용 = claude code 가 owner repo git log 으로 직접 카드 생성. design doc v2.3.
- **메모장 자동 선택** (V0.5.3): 페이지 진입 시 메모 1개 이상이면 최상단(`date desc, created_at desc`) 자동 선택. 모듈 flag (`didAutoSelectThisSession`) 로 세션당 한 번만 — 사용자가 onBack 한 뒤 페이지 갔다 와도 다시 자동 선택 X. 새로고침 시 reset.
- **메모장 사이드바 정렬** (V0.7.2): `useMeetingSort` (localStorage `goodsoob:meetingSort`) — `date_desc` (최신순, 기본) / `date_asc` (오래된순) / `name` (이름순). 키 우선순위 date → time → mtime. date/time 없는 메모는 같은 그룹 안에서 맨 아래로. 사이드바 헤더 "+" 옆 `ArrowUpDown` 아이콘 → popover 라디오.
- **useMeeting query race fix** (V0.7.2): `useMeeting(uid)` 가 `useMeetings()` 의 `isSuccess` 까지 대기 — 새로고침 시 hash 의 uid 가 즉시 set 되면서 detail queryFn 이 list 보다 먼저 실행되어 uidToPath miss → null 캐시 → 영구 skeleton 이던 race 차단. `uidToPath` miss / `readFullMeeting` exists false 는 null 반환 대신 throw → React Query 자동 retry (1·2·4초) 로 iCloud sync 중 stuck 도 자동 복구, 진짜 실패는 error UI 의 재시도 버튼.
- **마크다운 출력 포맷** (본인 회의록 spec, 외부 복사용): `## {title or "회의록"}` → `일시: YYYY.MM.DD (요일) [시간]` + `참석:` → `### 논의 사항` / `### 결정 사항` / `### 액션 아이템` 3섹션. 빈 섹션 omit. `lib/markdown.ts` `meetingToMarkdown()` 가 단일 source. ❌ "Notion 호환" 표현 쓰지 말 것.
- **마크다운 렌더링**: `react-markdown` + `remark-gfm`. `MarkdownView.tsx` — 디자인 토큰 기반 스타일링. `ol` 컴포넌트에서 `start` prop 통과 (떨어진 ordered list 번호 이어짐).
- **글로벌 툴팁** (V0.5.2): `<GlobalTooltip />` (`App.tsx`에 마운트). 모든 `title="..."` 속성을 hover 시 자동 커스텀 툴팁으로 변환. 250ms delay + 디자인 토큰 + 위치 자동 (top/bottom/left/right) + chain hover 즉시 표시. native title 비우고 `aria-label` 자동 보강.
- **Tauri**: 데스크탑 앱 셋업 완료 (`src-tauri/`). `bun run tauri:dev` / `tauri:build`. Vite 포트 1420 고정.

## 빌더 모드 톤

- 1인 본인 사용 도구. 매일 본인이 직접 쓰는 것이 검증.
- Over-engineering 회피. "production grade"가 정답이 아님.
- 매일 사용 시 신뢰 깨지는 곳 (data loss, 한 번도 발생 안 한 에러 silent fail)은 단단히.
- 그 외 generic SaaS pattern (multi-user, sharing, analytics, complex permissions) 절대 안 만듦.

## 디자인 시스템 (토큰 + 컴포넌트 + voice/tone)

`DESIGN.md` 가 토큰·컴포넌트 single source. `src/pages/StyleguidePage.tsx` 가 시각 카탈로그 (브라우저 `#styleguide` hash 진입 — VaultGate 우회). 새 컴포넌트는 styleguide 항목 추가 후 production 진입.

### 핵심 룰

- 모든 색은 `var(--*)` 토큰. hex 직접 박지 말 것 (예외: `useTheme.ts` radial-wipe JS 상수).
- 토큰 정의는 `src/index.css` 만 (`:root` + `.dark`). primitive layer 없이 semantic 단일.
- 새 컴포넌트는 `src/components/common/` 패턴 — variant + size + color prop, className/style override 통과.
- Tailwind 는 레이아웃 전용. `dark:` 색상 접두사 사용 금지 (`.dark` class + CSS var 가 처리).

### Voice & Tone — 9 카테고리 (1주차 lock-in)

`StyleguidePage` 의 Writing 섹션이 시각적 ✅/❌ 카탈로그. 코드/카피 작성 시 default.

- **종결어미**: `~합니다` 통일. `~해요` 혼용 X.
- **액션 라벨**: 명사형 (`삭제`, `저장`, `연결`). `~하기` 형식 X.
- **에러 메시지**: 원인 + 해결 2단. 사과 X. (예: "저장에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.")
- **날짜 형식**: 정밀 `YYYY.MM.DD`. 목록은 상대 (`5분 전`, `어제`) 또는 짧은 (`5월 23일`).
- **시간 형식**: `오전·오후 h:mm` 12시간 (소비자 톤).
- **숫자 · 단위**: 천 단위 `,`. 단위 한글, 붙임 (`30분`, `1MB`).
- **placeholder**: 명령형 안내 (`{필드}을 입력하세요`). `예: ...` 예시형 X (사용자 입력 좁힘), 영문/축약 X, 빈 placeholder X.
- **empty state**: heading + body + CTA 3단. 어미는 종결어미 정책 따름.
- **wrap**: `word-break: keep-all` 전역. chip · 날짜는 `whitespace-nowrap`, 영문 URL · 해시는 `break-all`, 한 줄 ellipsis 는 `truncate`.
- **문장부호**: 한국어 본문 em dash (`—`) 금지. 쉼표 · 괄호 · 마침표 사용 (영문 문맥은 OK).

## PR 작성 (포트폴리오 호환)

PR body 가 곧 vault `portfolio/` 카드의 본문이 됨. 양식 (한 줄 임팩트 / 문제 / Before / After / 디자인 결정 / 유저가 얻는 것 / 카테고리 7섹션) 은 `src/lib/clipboardPrompt.ts` 의 `buildPRGuidePrompt()` 가 single source. 카테고리 enum: `ui_ux | backend | infra | fix | other`. "PR 만들어줘" 요청 받으면 의도 / 유저 가치 / before-after 스크린샷 / 디자인 결정 / 카테고리 5가지 먼저 확보. 작은 변경(오타·dep bump 등 포트폴리오 가치 없는 것)은 PR 안 만들고 main 직커밋 허용.

todo.md/done.md 동기화는 `/takeoff` step 6.5 가 처리 (PR 안 미리 반영 — 머지로 main 진입).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer.

- 새 기능 brainstorm → `/office-hours`
- 아키텍처 검토 → `/plan-eng-review`
- 디자인 검토 (특히 V0.3 시작 시) → `/plan-design-review`
- 버그/의문 → `/investigate`
- 사이트 테스트 → `/qa` 또는 `/qa-only`
- 변경 review → `/review`
- 시각 폴리싱 → `/design-review`
- 배포 / PR → `/takeoff`

## 환경 / 명령어

- 패키지 매니저: **bun** (`bun install`, `bun run dev`, `bun add`, etc.)
- Tailwind v4 (`@import "tailwindcss"` + `@theme` block in `src/index.css`)
- TypeScript strict
- Tests: `bun run test:run` (one-off), `bun run test` (watch)
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- CI: `.github/workflows/ci.yml` — push(main) + PR 마다 `bun install --frozen-lockfile` → typecheck → test:run 자동 실행 (ubuntu, oven-sh/setup-bun@v2). Tauri build 는 OS 종속이라 CI 에서 skip.
- 배포: 없음 (Tauri 데스크탑 전용). `vercel.json` 으로 main deploy 비활성화. Vercel 대시보드 연동은 남아있지만 deploy 자체는 막혀있음.
- 마이그레이션 (DB): V0.6 부터 없음. vault = 로컬 md 파일. 스키마 변경 = md 파일 형식 변경 (frontmatter 필드 추가/이름 변경 등).
- **vault schema 변경 룰** (2026-05-27 첫 배포 이후): 첫 배포 전엔 "실데이터 가능성 0" 전제로 migration 코드를 생략했지만, 첫 배포로 매일 실데이터가 쌓이므로 그 전제는 폐기. 이제 frontmatter 필드 추가·이름 변경·structural 변경 모두 lazy migration 코드를 박는다 (첫 read 시 변환 + rewrite, V0.7.1 의 date-prefix→uid 발급 패턴이 선례). **단순 신규 필드** = default 값 fallback 으로 흡수 (migration 불필요), **의미 변경·필드 rename·structural 변경** = lazy migration 필수, 다단계면 versioned tag (`frontmatter.schema: N`) 검토. 산재 호출 방지용 runner 추상화는 todo.md "마이그레이션 헬퍼 추상화" 참조 — 첫 실제 schema 변경 PR 에 같이 도입.
- **메모 파일 모델** (V0.7.1): `meetings/{title}.md` (date 없음, title 이 곧 파일명). frontmatter = `id: <uuid>` (영구 식별자) + `date` (optional) + `time` + `attendees` + `tags`. **frontmatter 에 title 없음** — 파일명이 곧 노트 제목 (표준 마크다운 vault 의 일반 모델). 옛 V0.6 메모 (date prefix + frontmatter title) 는 lazy migration — 첫 read 시 uid 발급 + frontmatter rewrite. title 변경 = pure disk rename only (inode 유지, 파일명 = 노트 제목). 충돌 시 `TitleConflictError` throw (자동 -2 X). sidecar (`.transcript.md` / `.summary.md`) 패턴 그대로.

## 주의사항 / 알려진 footgun

- **Vault 폴더 위치**: iCloud Drive 안에 두면 자동 동기화 — 여러 기기에서 같은 데이터. sync 도구 부산물은 `lib/vault/scan.ts` 의 `isSyncNoiseFile` 가 스캔에서 자동 제외 — `(conflicted copy)` / `.icloud` placeholder / dotfile.
- **Tauri `assetProtocol` scope** (V0.7.2): `tauri.conf.json` 의 `app.security.assetProtocol.scope = ["$HOME/**"]` — portfolio 카드의 vault 안 스크린샷이 `convertFileSrc()` 로 만든 `asset://` URL 로 로드되도록. 이미 `fs:scope-home-recursive` 와 동등 수준이라 권한 확장은 0. 좁히려면 vault root 동적 scope 가 필요 (별 작업). `Cargo.toml` 에 `tauri = { features = ["protocol-asset"] }` 박혀있어야 동작.
- **동시 편집 충돌**: 다른 기기/에디터가 같은 파일 수정 + 데스크탑도 수정 = mtime mismatch → `ConflictError`. UI 가 보존/덮어쓰기 선택 모달 띄움 (Phase 6 polish).
- **Tauri 데스크탑 전용**: V0.6 부터 PWA 빌드 폐기. `bun run tauri:dev` / `tauri:build` 만 사용.
- **Pretendard CDN**: `index.html`에서 로드. 본인 도메인에서 첫 로딩 ~50ms 추가. 빠른 로컬 fallback (`-apple-system`)이 base case.
- **gh CLI 의존** (V0.7): portfolio sync 는 `gh` 가 macOS keychain 에 토큰 저장해둔 것에 위임. 첫 셋업 1회 `gh auth login` 필요. 회사 GitHub Enterprise 면 `--hostname` 추가. gh/claude 호출은 `bash -lc` 래핑 (`portfolio` capability 가 `sh`+`bash` 둘 다 허용; curl/zip/open 은 `sh -lc` 유지) + `fs:scope` 에 dotfile path 추가 (`.synced.md` 같은 케이스).
- **release PATH footgun** (실측 버그): Finder/Dock 로 실행한 release `.app` 은 launchd 최소 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)로 시작 → `gh`(`~/.local/bin`)·`claude`(nvm)·brew 가 PATH 밖. 옛 `sh -lc` 의 `-l` 은 `/etc/profile`+`~/.profile` 만 읽고 PATH 를 세팅하는 `~/.bash_profile`/`~/.zshrc` 는 안 읽음 → `command not found`(code 127) → `GhNotInstalledError`. **dev(`tauri:dev`)가 됐던 건 `-l` 이 아니라 터미널에서 띄운 부모 프로세스 PATH 상속 덕분** — release 는 상속 없어 깨짐. fix: `bash -lc`(login 셸 → `~/.bash_profile` 로딩). 외부 CLI 새로 위임할 때 같은 함정 주의 — `loginShellArgs` 경유할 것.
- **Rust 빌드 산출물은 iCloud 밖 (`target.nosync`)** (2026-06-20 실측): 이 repo 는 iCloud Drive(`com~apple~CloudDocs`) 안에 있어 기본 `src-tauri/target/` 까지 iCloud 동기화 대상이 된다. iCloud 가 deps 파일 mtime 을 건드리면 cargo 가 mtime 기반 fingerprint 로 전부 stale 판정 → `tauri:dev` 마다 453 crate **풀 빌드** (+ 매 빌드 2~4GB 를 iCloud 에 재업로드). fix: `src-tauri/.cargo/config.toml` 의 `target-dir = "target.nosync"` (커밋됨, 상대경로 → 각 기기 `src-tauri/target.nosync/`). `.nosync` 접미사는 iCloud 가 동기화 제외 → mtime churn 0, incremental 정상. **target 은 원래 기기별 로컬**(절대경로·아키텍처·rustc 버전 박힘)이라 기기 간 공유가 오히려 버그 — 각 Mac 이 자기 target.nosync 를 갖고 최초 1회만 풀 빌드. config 가 커밋돼 있어 **다른 기기는 git pull 만 하면 자동 적용**, 별도 설정 불필요. `src-tauri/.gitignore` 에 `/target.nosync/` 등록. ⚠️ 빌드 전 `du -sh src-tauri/target` 으로 옛 iCloud target 이 되살아났는지 확인 — 보이면 `rm -rf` (config 무시하고 옛 경로 쓰는 잔재).
- **takeoff 스크린샷 캡쳐 — tmux 화면 기록 권한 함정** (실측): takeoff/start 의 BEFORE/AFTER 캡쳐는 `scripts/capture-window.sh` 가 `screencapture -l<windowID>` 로 dev 창을 직접 찍는다. 그런데 **tmux 세션 안에서 Claude Code 를 돌리면** `screencapture` 의 TCC 권한 책임 프로세스가 터미널 앱이 아니라 **tmux 서버(데몬)** 로 잡혀, 터미널에 화면 기록 권한을 줘도 안 먹고 "could not create image from display/window" 로 전부 실패한다 (전체화면 `-x` 까지). tmux 바이너리에 권한을 주고 `tmux kill-server` 로 재시작해야 먹지만 그러면 현재 세션이 끊김. **그래서 권한 불필요 경로를 기본으로 둠**: 네이티브 스크린샷(Cmd+Shift+4 → Space → 창 클릭, WindowServer 가 캡쳐라 권한 무관)으로 찍은 뒤 `scripts/import-screenshot.sh <before|after> [n]` 가 macOS 스크린샷 저장 폴더의 **최근 10분 내 최신 png** 를 `~/Screenshots/{repo}/{slug}-{phase}-{n}.png` 로 옮긴다 (capture-window.sh 와 동일 슬러그 규칙). `capture-window.sh` 도 캡쳐 실패 시 이 import 경로를 안내한다. dev 창 제목이 "짱수 · {branch}" 로 안 박히고 "app" 으로 남는 문제 때문에 `find-window.swift` 는 제목 대신 "최전면 앱 창" 으로 매칭 (V0.7.5).
