# goodsoob-work

본인 전용 시간축 통합 업무관리 PWA. 회의록 + Todo + 일정 + 일기를 한 화면에 시간축으로 layered.

- **Stack**: React 19 + TypeScript + Vite + Tailwind v4 + Supabase + TanStack Query + vite-plugin-pwa
- **Auth**: Supabase Auth (Google OAuth)
- **AI**: Anthropic Claude (Supabase Edge Function 경유, V0.1+)
- **Backend**: Supabase 무료 티어

플랜 상세: `goodsoob-work-plan.md`. Design doc / eng review / design review는 `~/.gstack/projects/goodsoob-work/`.

## 로드맵

- **V0.0** (현재) — Vite + Supabase Auth + Hello world. PWA 셋업.
- **V0.1** (1주) — 회의록 CRUD + AI 요약 + 마크다운 복사.
- **V0.2** (1주) — 일기 + 주간 캘린더.
- **V0.3** (1-2주) — Todo + 일정 + 통합 타임라인.
- **V0.4+** — 액션아이템 → Todo 1-click 이동.

## 로컬 개발 시작 (V0.0)

```bash
bun install
cp .env.example .env.local
# .env.local 채우기 (Supabase Setup 섹션 참조)
bun run dev
```

`http://localhost:5173` 열면 Google 로그인 화면. 로그인 후 hello world.

## Supabase Setup (V0.0 — 1회)

1. https://supabase.com/dashboard 에서 새 프로젝트 생성. Project name: `goodsoob-work`. 비밀번호 안전한 곳에 저장.
2. **Project Settings → API** 에서:
   - `Project URL` → `.env.local`의 `VITE_SUPABASE_URL`
   - `anon public` key → `.env.local`의 `VITE_SUPABASE_ANON_KEY`
3. **Authentication → Providers → Google** 활성화:
   - Google Cloud Console (https://console.cloud.google.com/) → 새 프로젝트 → APIs & Services → Credentials → Create OAuth Client ID (Web application)
   - Authorized redirect URIs: `https://<your-supabase-project-id>.supabase.co/auth/v1/callback` 추가
   - Client ID + Client Secret을 Supabase 대시보드 Google provider에 입력
4. **Authentication → URL Configuration** 에서:
   - Site URL: 로컬 `http://localhost:5173`, 배포 후엔 배포 도메인 추가
   - Redirect URLs: `http://localhost:5173/`, `https://<your-deploy-domain>/`
5. `bun run dev` → Google 로그인 시도 → 콜백까지 정상 도착 확인.

## 폴더 구조

```
src/
  api/                         # Supabase CRUD wrappers (V0.1+)
  components/
    auth/
      AuthGate.tsx              # 로그인 안 되어 있으면 SignInScreen
      SignInScreen.tsx          # Google 버튼 + 에러 처리
    meetings/                  # V0.1 회의록 컴포넌트
  hooks/
    useAuth.ts                  # Supabase auth 상태 + signIn / signOut
  lib/
    supabase.ts                 # Supabase 클라이언트 (env-based)
    queryClient.ts              # TanStack Query config
    database.types.ts           # Supabase 자동 생성 (추후)
  pages/
    HomePage.tsx                # V0.0 placeholder, V0.3에선 통합 타임라인
  test/
    setup.ts                    # Vitest + jest-dom
  App.tsx                       # AuthGate + HomePage
  main.tsx                      # QueryClient + StrictMode root
  index.css                     # Tailwind v4 + theme 토큰

public/
  favicon.svg
  icon-{192,512,512-maskable}.png  # PWA icons (scripts/gen-icons.ts로 생성)
  apple-touch-icon.png

scripts/
  gen-icons.ts                   # SVG → PNG 변환 (sharp)

supabase/                        # V0.1+ Edge Functions
  functions/
    summarize/                   # Anthropic 호출

~/.gstack/projects/goodsoob-work/  # 외부: design doc, plan reviews, test plan
```

## Design 토큰

- **Type**: Pretendard Variable (CDN)
- **Color (Light)**: bg-white, text-zinc-900, border-zinc-200, accent **red-600**
- **Color (Dark)**: bg-zinc-950, text-zinc-100, border-zinc-800, accent **red-500**
- **Spacing**: Tailwind p-4/6/8/12 (generous)
- **Radius**: rounded-lg (8px)
- **Rule**: UI 자체는 monotone. RED은 의미 있는 1군데에만 (오늘 marker, primary CTA, 활성 탭).

## Scripts

- `bun run dev` — Vite dev server (`http://localhost:5173`)
- `bun run build` — Production build to `dist/`
- `bun run preview` — Serve `dist/` locally
- `bun run typecheck` — `tsc -b --noEmit`
- `bun run test` — Vitest (watch mode)
- `bun run test:run` — Vitest (one-off)
- `bun run lint` — ESLint
- `bun run icons` — Regenerate PWA icons from `public/favicon.svg`

## Followups (V0.0 이후 즉시)

- [ ] Supabase 프로젝트 생성 + Google OAuth 설정 (위 Setup)
- [ ] `.env.local` 채우기
- [ ] 배포 + 도메인 받기
- [ ] iPhone PWA 설치 + 로그인 흐름 직접 테스트
- [ ] (선택) `public/favicon.svg` 본인 브랜드로 교체 후 `bun run icons` 재실행
