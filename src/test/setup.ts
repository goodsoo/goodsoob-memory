import "@testing-library/jest-dom/vitest";

// jsdom(29) + vitest(4) 조합이 localStorage 를 globalThis 에 노출하지 않아
// useZoom·registry 테스트의 localStorage.clear/getItem 이 TypeError 로 죽었다
// (CI 에서도 동일 — test job red 의 원인). 테스트 전용 in-memory shim 으로 채운다.
// 앱 런타임(브라우저·PWA)엔 진짜 localStorage 가 있으므로 프로덕션 영향 0.
if (typeof globalThis.localStorage === "undefined") {
  class MemoryStorage implements Storage {
    #store = new Map<string, string>();
    get length(): number {
      return this.#store.size;
    }
    clear(): void {
      this.#store.clear();
    }
    getItem(key: string): string | null {
      return this.#store.has(key) ? this.#store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.#store.set(key, String(value));
    }
    removeItem(key: string): void {
      this.#store.delete(key);
    }
    key(index: number): string | null {
      return [...this.#store.keys()][index] ?? null;
    }
  }
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}
