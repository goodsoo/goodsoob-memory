import { isTauri } from "./isTauri";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

// macOS Tauri 데스크탑 — Overlay titlebar 가 적용되는 환경.
// Windows/Linux Tauri 와 웹 (PWA, dev) 에서는 false.
export const isMacTauri = isTauri && isMac && !/iPhone|iPad/.test(navigator?.userAgent ?? "");

export function applyPlatformClasses(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isMacTauri) root.classList.add("is-mac-tauri");
}

// dev 에서만: 창 제목에 현재 브랜치를 박아 동시에 띄운 worktree 세션 창을 구분한다.
// cmd+Tab / Mission Control / 캡쳐 스크립트가 창을 식별하는 키가 된다.
// release 에서는 tauri.conf.json 의 기본 제목("짱수")을 그대로 둔다.
export function applyDevWindowTitle(): void {
  if (!isTauri || !import.meta.env.DEV) return;
  const branch = __DEV_BRANCH__;
  if (!branch) return;
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    void getCurrentWindow()
      .setTitle(`짱수메모리 · ${branch}`)
      .catch(() => {});
  });
}
