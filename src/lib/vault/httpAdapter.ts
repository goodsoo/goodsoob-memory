/**
 * createHttpAdapter (T2) — fetch + SSE 로 로컬 서버(server/index.ts)에 붙는 VaultAdapter.
 *
 * 폰·air·Pro 브라우저가 쓰는 런타임 어댑터. 서버가 정본 vault(git repo)를 소유.
 *
 * 계약 변경 (design doc "어댑터 계약 변경"):
 *  - write(rel, content, expectedMtime?): expectedMtime = **no-op**. 절대 ConflictError
 *    안 던짐. 항상 새 버전으로 얹음(lossless/append-only). 서버가 git 커밋으로 히스토리 보존.
 *  - watch(): 서버 SSE 소비 → VaultWatchEvent 변환. 재연결 로직 포함.
 *  - readMeta().mtime: 소스 = 서버 git 커밋 시각(서버가 반환).
 */

import type { VaultAdapter, VaultWatchEvent, FileMeta } from "./adapter";

export interface HttpAdapterOptions {
  /** 서버 base URL. 기본 = 같은 origin(''), 즉 상대경로 fetch. */
  baseUrl?: string;
  /** fetch 타임아웃(ms). 기본 15초. */
  timeoutMs?: number;
  /** SSE 재연결 backoff 최대(ms). 기본 10초. */
  maxReconnectMs?: number;
  /** 테스트 주입용 fetch. */
  fetchImpl?: typeof fetch;
  /** 테스트 주입용 EventSource 생성자. */
  eventSourceImpl?: typeof EventSource;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function createHttpAdapter(opts: HttpAdapterOptions = {}): VaultAdapter {
  const baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxReconnectMs = opts.maxReconnectMs ?? 10000;
  const doFetch = opts.fetchImpl ?? fetch;
  const ESImpl =
    opts.eventSourceImpl ??
    (typeof EventSource !== "undefined" ? EventSource : undefined);

  // 서버가 정본 root 를 소유하므로 client root 는 표시·escape-hatch(포트폴리오 asset)용
  // 로만 추적한다. 실제 파일 접근은 전부 rel path 로 서버에 위임.
  let root: string | null = null;

  const api = (path: string): string => `${baseUrl}${path}`;

  async function request(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(api(path), {
        ...init,
        signal: controller.signal,
      });
      return res;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`vault 서버 요청 타임아웃(${timeoutMs}ms): ${path}`);
      }
      // 서버 다운·네트워크 오류 — silent fail 금지, 명시 throw.
      throw new Error(`vault 서버 연결 실패: ${path} — ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path);
    if (!res.ok) {
      throw new HttpError(res.status, await errText(res, path));
    }
    return (await res.json()) as T;
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new HttpError(res.status, await errText(res, path));
    }
    return (await res.json()) as T;
  }

  async function errText(res: Response, path: string): Promise<string> {
    try {
      const j = (await res.json()) as { error?: string };
      return j.error ?? `${res.status} ${path}`;
    } catch {
      return `${res.status} ${path}`;
    }
  }

  const enc = (v: string) => encodeURIComponent(v);

  return {
    setRoot(absPath: string) {
      root = absPath;
    },
    getRoot() {
      return root;
    },

    async list(subdir: string): Promise<string[]> {
      const { paths } = await getJson<{ paths: string[] }>(
        `/api/vault/list?mode=flat&subdir=${enc(subdir)}`,
      );
      return paths;
    },

    async listRecursive(subdir: string): Promise<string[]> {
      const { paths } = await getJson<{ paths: string[] }>(
        `/api/vault/list?mode=recursive&subdir=${enc(subdir)}`,
      );
      return paths;
    },

    async listFoldersRecursive(subdir: string): Promise<string[]> {
      const { paths } = await getJson<{ paths: string[] }>(
        `/api/vault/list?mode=folders&subdir=${enc(subdir)}`,
      );
      return paths;
    },

    async read(relPath: string): Promise<string> {
      const { content } = await getJson<{ content: string }>(
        `/api/vault/read?path=${enc(relPath)}`,
      );
      return content;
    },

    async readMeta(relPath: string): Promise<FileMeta> {
      // mtime 소스 = 서버 git 커밋 시각 (서버 readMeta 가 그렇게 채움).
      return getJson<FileMeta>(`/api/vault/meta?path=${enc(relPath)}`);
    },

    async write(
      relPath: string,
      content: string,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _expectedMtime?: number,
    ): Promise<FileMeta> {
      // expectedMtime 은 no-op. 절대 ConflictError 안 던짐 — 항상 새 버전으로 얹음.
      return postJson<FileMeta>(`/api/vault/write`, {
        path: relPath,
        content,
      });
    },

    async writeBinary(
      relPath: string,
      bytes: Uint8Array,
    ): Promise<FileMeta> {
      const res = await request(`/api/vault/writeBinary?path=${enc(relPath)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw new HttpError(res.status, await errText(res, relPath));
      return (await res.json()) as FileMeta;
    },

    async delete(
      relPath: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      await postJson(`/api/vault/delete`, {
        path: relPath,
        recursive: options?.recursive === true,
      });
    },

    async rename(fromRel: string, toRel: string): Promise<void> {
      await postJson(`/api/vault/rename`, { from: fromRel, to: toRel });
    },

    async exists(relPath: string): Promise<boolean> {
      const { exists } = await getJson<{ exists: boolean }>(
        `/api/vault/exists?path=${enc(relPath)}`,
      );
      return exists;
    },

    async mkdir(relPath: string): Promise<void> {
      await postJson(`/api/vault/mkdir`, { path: relPath });
    },

    async watch(
      callback: (event: VaultWatchEvent) => void,
    ): Promise<() => void> {
      if (!ESImpl) {
        // SSE 불가 환경(구형/테스트) — no-op unsubscribe. 서버 폴백은 상위(T5 outbox)에서.
        return () => {};
      }
      let es: EventSource | null = null;
      let closed = false;
      let backoff = 500;

      const connect = (): void => {
        if (closed) return;
        es = new ESImpl(api(`/api/vault/watch`));

        es.addEventListener("ready", () => {
          backoff = 500; // 연결 성공 시 backoff reset
        });

        es.addEventListener("change", (e: MessageEvent) => {
          try {
            const ev = JSON.parse(e.data) as VaultWatchEvent;
            callback(ev);
          } catch {
            /* malformed event 무시 */
          }
        });

        es.onerror = () => {
          // SSE 표준 재연결이 있지만, 서버 재기동 등으로 끊기면 명시 backoff 재연결.
          if (closed) return;
          es?.close();
          es = null;
          const delay = Math.min(backoff, maxReconnectMs);
          backoff = Math.min(backoff * 2, maxReconnectMs);
          setTimeout(connect, delay);
        };
      };

      connect();

      return () => {
        closed = true;
        es?.close();
        es = null;
      };
    },
  };
}
