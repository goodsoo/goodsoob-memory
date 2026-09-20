# goodsoob-memory

본인 전용 시간축 통합 업무관리 PWA. 회의록 + Todo + 일정 + 일기 + 포트폴리오를 한 화면에 시간축으로 layered. (구 `goodsoob-work`.)

- **Stack**: React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query + vite-plugin-pwa
- **Design System**: `@goodsoob/ds` (canonical DS, `file:../goodsoob-design-system`) — 로컬 컴포넌트 복사본 없음, 토큰은 봉인검사(`scripts/ds-guard.mjs`)로 대조
- **Storage**: 로컬 vault (파일시스템 git repo). 클라우드 백엔드 없음
- **Runtime**: mac 로컬 서버(`server/index.ts`, Bun)가 정본 vault 를 소유하는 단일 writer + 브라우저/PWA 대신 CLI(gh/claude/curl/zip) 위임 실행(`src/lib/runtime.ts`). launchd 상주, `127.0.0.1` loopback only
- **Auth**: GitHub CLI (`gh auth login`) — 포트폴리오 PR 수집용 (`src/lib/portfolio/gh.ts`)
- **AI**: Anthropic Claude — mac 서버 경유 `claude` CLI (`src/lib/portfolio/claude.ts`)

플랜/설계 상세: `goodsoob-work-plan.md`, `docs/designs/`.

## 로컬 개발

```bash
bun install
bun run dev                                        # Vite dev server → http://localhost:5173
VAULT_DIR=/path/to/vault bun run server/index.ts   # 로컬 서버 (vault + CLI seam)
```

- 폰·air·Pro 모두 브라우저로 로컬 서버에 접속한다 (tower·growth 와 동일 골격).
- 서버가 안 떠 있으면 CLI 위임 기능(PR 수집·AI 요약·백업)은 degraded 표시 — silent fail 없음.

## 폴더 구조

```
src/
  api/            # vault 어댑터 위 CRUD (journals/meetings/tasks/routines/schedule/portfolio…)
  components/     # calendar meetings tasks routines today portfolio settings nav vault common
  hooks/
  lib/
    vault/        # VaultAdapter — 로컬 파일시스템 백엔드
    portfolio/    # gh/claude/screenshot 등 CLI seam 래퍼
    markdown/     # 마크다운 파싱·타이핑
  pages/
  pwa/
  test/
  App.tsx
  main.tsx        # QueryClient + StrictMode root
  index.css       # Tailwind v4 (+ @goodsoob/ds 토큰)

server/
  index.ts        # 로컬 서버 (Bun): dist 정적 서빙 + /api/vault/* + SSE watch + git 안전망
  vaultCore.ts
  shell.ts

scripts/
  gen-icons.ts    # SVG → PNG PWA 아이콘 (sharp)
  ds-guard.mjs    # DS 토큰 봉인검사
  ds-sentinel.mjs
  ...

docs/designs/     # office-hours design docs
```

## Design

UI 는 canonical DS(`@goodsoob/ds`)를 따른다 — 토큰·컴포넌트는 DS repo(`goodsoob-design-system`)가 정본. 로컬 override 금지, 토큰 봉인검사(`scripts/ds-guard.mjs`)로 대조.

## Scripts

- `bun run dev` — Vite dev server (`http://localhost:5173`)
- `bun run build` — `tsc -b` + Vite production build → `dist/`
- `bun run preview` — `dist/` 로컬 서빙
- `bun run typecheck` — `tsc -b --noEmit`
- `bun run test` — Vitest (watch)
- `bun run test:run` — Vitest (1회)
- `bun run lint` — ESLint
- `bun run icons` — PWA 아이콘 재생성 (`public/favicon.svg` 기준)
