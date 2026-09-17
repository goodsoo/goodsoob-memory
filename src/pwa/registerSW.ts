/**
 * Service Worker 등록 — PWA 앱 셸 설치 지원.
 * 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작합니다.
 */
export function registerSW(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW 등록 실패는 앱 동작에 영향을 주지 않으므로 무시합니다.
    });
  });
}
