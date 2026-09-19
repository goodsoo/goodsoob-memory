export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function applyPlatformClasses(): void {
  // web/PWA 단일 아키텍처 — 현재 플랫폼 파생 클래스 없음. 훅 지점만 유지.
}

// dev 에서만: document.title 에 현재 브랜치를 박아 동시에 띄운 worktree 세션 탭/창을
// 구분한다. release 에서는 index.html 의 기본 제목을 그대로 둔다.
export function applyDevWindowTitle(): void {
  if (!import.meta.env.DEV || typeof document === "undefined") return;
  const branch = __DEV_BRANCH__;
  if (!branch) return;
  document.title = `짱수메모리 · ${branch}`;
}
