import type { QueryClient } from "@tanstack/react-query";
import type { VaultAdapter, VaultWatchEvent } from "./adapter";
import { isMeetingSidecar, isNonNotePath, meetingMainPath } from "./scan";

// vault 변경 시 어떤 query key 를 invalidate 할지 매핑.
// hooks 의 query key 와 일치해야 함. 앱 소유 폴더는 `_` prefix (메모장 노트는
// brain root 전체라 `_`/`.` 네임스페이스 밖의 .md 전부가 메모 대상).
function affectedQueryKeys(path: string): unknown[][] {
  const keys: unknown[][] = [];
  if (path.startsWith("_journals/")) {
    keys.push(["journals"]);
    keys.push(["journals", path]);
    keys.push(["todos"]);
  } else if (path.startsWith("_routines/")) {
    keys.push(["routines"]);
    const base = path.split("/").pop() ?? "";
    const name = base.replace(/\.md$/, "");
    if (name) keys.push(["routine", name]);
  } else if (path.startsWith("_portfolio/")) {
    keys.push(["portfolio"]);
    keys.push(["portfolio", path]);
    if (path === "_portfolio/categories.md") {
      keys.push(["portfolio-categories"]);
    }
    // 폴더 변경 (rename/create/delete) 도 사이드바 트리 새로고침 필요
    keys.push(["portfolio-folders"]);
    // _attachments/* 변경도 카드 새로고침 필요 (썸네일 캐시)
  } else if (path === "_tasks/inbox.md" || path.startsWith("_tasks/")) {
    keys.push(["todos"]);
    keys.push(["inbox"]);
  } else if (path === "_schedule.md") {
    keys.push(["schedule"]);
    keys.push(["todos"]); // 일정이 오늘/할 일 통합 뷰에 영향
  } else if (path.endsWith(".md") && !isNonNotePath(path)) {
    // brain 안 일반 노트 (`_`/`.` 네임스페이스 밖의 모든 .md) = 메모장 대상.
    keys.push(["meetings"]);
    // sidecar (.transcript.md / .summary.md) 변경 시 메인 path key 로 invalidate.
    const mainPath = isMeetingSidecar(path) ? meetingMainPath(path) : path;
    keys.push(["meetings", mainPath]);
    keys.push(["todos"]); // 메모 안 task 가 통합 뷰에 영향
  }
  return keys;
}

// debounce 헬퍼 (한 파일에 대한 빠른 연속 변경을 합침)
function debounceByKey<T>(
  fn: (key: string, value: T) => void,
  delayMs: number,
): (key: string, value: T) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key, value) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn(key, value);
      }, delayMs),
    );
  };
}

export interface WatcherOptions {
  // 우리가 직접 write 한 직후의 modified 이벤트는 무시 (자기 변경).
  // adapter.write() 호출 직후 같은 path 를 markSelfWrite 로 등록해두면 N ms 내 modified 이벤트 skip.
  selfWriteWindowMs?: number;
}

export interface VaultWatcher {
  start(): Promise<void>;
  stop(): void;
  markSelfWrite(path: string): void;
}

export function createVaultWatcher(
  adapter: VaultAdapter,
  queryClient: QueryClient,
  options: WatcherOptions = {},
): VaultWatcher {
  const selfWindow = options.selfWriteWindowMs ?? 1000;
  const selfWrites = new Map<string, number>(); // path → timestamp
  let unwatch: (() => void) | null = null;

  const invalidateForPath = debounceByKey<void>((path) => {
    for (const key of affectedQueryKeys(path)) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, 100);

  const handle = (event: VaultWatchEvent) => {
    const path = "path" in event ? event.path : event.to;
    // 자기 write 인지 확인. 한 번의 write 가 notify-rs 이벤트를 여러 개 쏠 수 있어
    // (create + modify 등) 첫 매칭에서 지우지 않고 window 만료(markSelfWrite 의 cleanup
    // 타이머)까지 유지한다 — 그래야 같은 write 의 후속 echo 가 invalidate 로 새지 않음.
    const recent = selfWrites.get(path);
    if (recent && Date.now() - recent < selfWindow) {
      return;
    }
    invalidateForPath(path);
  };

  return {
    async start() {
      if (unwatch) return;
      unwatch = await adapter.watch(handle);
    },
    stop() {
      if (unwatch) {
        unwatch();
        unwatch = null;
      }
    },
    markSelfWrite(path: string) {
      selfWrites.set(path, Date.now());
      // window 지나면 cleanup
      setTimeout(() => selfWrites.delete(path), selfWindow * 2);
    },
  };
}
