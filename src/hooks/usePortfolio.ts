// V0.7 step 6 — portfolio hooks (TanStack Query).
// useMeetings 패턴 그대로. useGhSync 는 별도 (mutable run state 보유).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ATTACHMENTS_DIR,
  PORTFOLIO_DIR,
  PORTFOLIO_TRASH_DIR,
  createManualPortfolioWork,
  createPortfolioFolder,
  deletePortfolioFolder,
  deriveCategoryUnion,
  emptyPortfolioTrash,
  fileToPortfolioWork,
  listManualFolders,
  listTrashedPortfolioWorks,
  moveManualCard,
  portfolioWorkPath,
  purgePortfolioWork,
  readSyncState,
  readPortfolioWork,
  renamePortfolioFolder,
  restorePortfolioWork,
  scanPortfolio,
  syncPortfolio,
  type CreateManualPortfolioInput,
  type PortfolioWork,
  type PortfolioWorkFrontmatter,
  type PortfolioWorkMeta,
  type SyncPortfolioOpts,
  type SyncPortfolioResult,
  type TrashedPortfolioWork,
} from "../api/portfolio";
import { useVault } from "../lib/vault/useVault";
import { patchFrontmatter } from "../lib/vault/parser";

const worksKey = ["portfolio"] as const;
const workKey = (slug: string) => ["portfolio", "work", slug] as const;
const foldersKey = ["portfolio-folders"] as const;
const trashKey = ["portfolio", "trash"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Works

export function usePortfolioWorks() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: worksKey,
    queryFn: () => scanPortfolio(adapter),
    enabled: isReady,
  });
}

export function usePortfolioWork(slug: string | undefined) {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: slug ? workKey(slug) : ["portfolio", "work", "none"],
    queryFn: () => readPortfolioWork(adapter, slug!),
    enabled: !!slug && isReady,
  });
}

// frontmatter 의 본인 수정 필드 patch (project / included / category / impact_summary).
// notes 본문 patch 는 별도 (body parse 필요).
export type PortfolioFrontmatterPatch = Partial<
  Pick<
    PortfolioWorkFrontmatter,
    "included" | "category" | "impact_summary" | "screenshots"
  >
>;

export function useUpdatePortfolioFrontmatter(slug: string) {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: PortfolioFrontmatterPatch) => {
      // cache 의 list 에서 slug 매칭되는 work 의 실제 filePath 사용.
      // portfolioWorkPath(slug) 만 가정하면 폴더 안 수동 카드 / NFC·NFD 정규화 차이 카드
      // 에서 read throw → optimistic rollback 으로 옛 값 복귀하던 race 차단.
      const list = qc.getQueryData<PortfolioWorkMeta[]>(worksKey);
      const found = list?.find((w) => w.prSlug === slug);
      const path = found?.filePath ?? portfolioWorkPath(slug);
      const raw = await adapter.read(path);
      const newRaw = patchFrontmatter(raw, patch as Record<string, unknown>);
      const meta = await adapter.write(path, newRaw);
      watcher.markSelfWrite(path);
      // readPortfolioWork 도 같은 path 로 직접 — slug→path 추정 회피.
      const updatedRaw = await adapter.read(path);
      return fileToPortfolioWork(path, updatedRaw, meta.mtime);
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: workKey(slug) });
      const prevWork = qc.getQueryData<PortfolioWork>(workKey(slug));
      const prevList = qc.getQueryData<PortfolioWorkMeta[]>(worksKey);
      if (prevWork) {
        qc.setQueryData<PortfolioWork>(workKey(slug), {
          ...prevWork,
          frontmatter: { ...prevWork.frontmatter, ...patch },
        });
      }
      qc.setQueryData<PortfolioWorkMeta[]>(worksKey, (curr) =>
        curr?.map((w) =>
          w.prSlug === slug
            ? { ...w, frontmatter: { ...w.frontmatter, ...patch } }
            : w,
        ),
      );
      return { prevWork, prevList };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevWork) qc.setQueryData(workKey(slug), ctx.prevWork);
      if (ctx?.prevList) qc.setQueryData(worksKey, ctx.prevList);
    },
    onSuccess: (updated) => {
      if (updated) {
        qc.setQueryData(workKey(slug), updated);
      }
      qc.invalidateQueries({ queryKey: worksKey });
    },
  });
}

// 수동 카드 생성 — PR 무관 (오프라인 업무, 회의 발표 등). legacy schema 로 저장.
export function useCreateManualPortfolioWork() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateManualPortfolioInput) => {
      const work = await createManualPortfolioWork(adapter, input);
      watcher.markSelfWrite(work.filePath);
      return work;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worksKey });
    },
  });
}

// 삭제 = portfolio/.trash/ 로 이동 (메모장 vault `.trash/` 와 별개 — portfolio 도메인 내부 휴지통).
// _attachments/{slug}/ 짝도 같은 stamp 로 portfolio/.trash/ 이동.
export function useDeletePortfolioWork() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const cardPath = portfolioWorkPath(slug);
      await adapter.mkdir(PORTFOLIO_TRASH_DIR);
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      // 카드 파일 이동
      await adapter.rename(
        cardPath,
        `${PORTFOLIO_TRASH_DIR}/${stamp}-${slug}.md`,
      );
      watcher.markSelfWrite(cardPath);
      // _attachments/{slug}/ 짝 이동 — best effort, 없으면 skip
      const attachDir = `${ATTACHMENTS_DIR}/${slug}`;
      try {
        if (await adapter.exists(attachDir)) {
          await adapter.rename(
            attachDir,
            `${PORTFOLIO_TRASH_DIR}/${stamp}-attachments-${slug}`,
          );
        }
      } catch {
        // 디렉토리 rename 실패 — 로컬 서버/OS 의존, 매일 사용에서 발견하면 fix
      }
      return slug;
    },
    onSuccess: (slug) => {
      qc.setQueryData<PortfolioWorkMeta[]>(worksKey, (prev) =>
        prev?.filter((w) => w.prSlug !== slug),
      );
      qc.removeQueries({ queryKey: workKey(slug) });
      qc.invalidateQueries({ queryKey: trashKey });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trash

export function useTrashedPortfolioWorks() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: trashKey,
    queryFn: () => listTrashedPortfolioWorks(adapter),
    enabled: isReady,
  });
}

// 복원 — trashPath → 원위치. 충돌 시 throw → 호출처에서 toast.
export function useRestorePortfolioWork() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (trashPath: string) => {
      const restored = await restorePortfolioWork(adapter, trashPath);
      watcher.markSelfWrite(restored);
      return restored;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worksKey });
      qc.invalidateQueries({ queryKey: trashKey });
    },
  });
}

// 영구 삭제 (휴지통에서만) — 카드 + attachments 폴더 안 파일 모두 삭제.
export function usePurgePortfolioWork() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (trashPath: string) => {
      await purgePortfolioWork(adapter, trashPath);
      return trashPath;
    },
    onSuccess: (trashPath) => {
      qc.setQueryData<TrashedPortfolioWork[]>(trashKey, (prev) =>
        prev?.filter((t) => t.trashPath !== trashPath),
      );
    },
  });
}

// 휴지통 비우기 — portfolio/.trash 안 카드 + attachments 모두 영구 삭제.
export function useEmptyPortfolioTrash() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await emptyPortfolioTrash(adapter);
    },
    onSuccess: () => {
      qc.setQueryData<TrashedPortfolioWork[]>(trashKey, []);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual folders — vault 실제 디렉토리 트리. 메모장 폴더 패턴 동형.

export function useManualFolders() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: foldersKey,
    queryFn: () => listManualFolders(adapter),
    enabled: isReady,
  });
}

export function useCreatePortfolioFolder() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parent: string; name: string }) => {
      const path = await createPortfolioFolder(adapter, input.parent, input.name);
      watcher.markSelfWrite(`${PORTFOLIO_DIR}/${path}`);
      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKey });
    },
  });
}

export function useRenamePortfolioFolder() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fromPath: string; newName: string }) => {
      const toPath = await renamePortfolioFolder(
        adapter,
        input.fromPath,
        input.newName,
      );
      watcher.markSelfWrite(`${PORTFOLIO_DIR}/${input.fromPath}`);
      watcher.markSelfWrite(`${PORTFOLIO_DIR}/${toPath}`);
      return { fromPath: input.fromPath, toPath };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKey });
      qc.invalidateQueries({ queryKey: worksKey });
    },
  });
}

// 수동 카드의 폴더 이동 — disk rename. 카드 frontmatter 안 만짐 (vault path 가 진실).
export function useMoveManualCard() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fromPath: string; toFolder: string }) => {
      const newPath = await moveManualCard(
        adapter,
        input.fromPath,
        input.toFolder,
      );
      watcher.markSelfWrite(input.fromPath);
      watcher.markSelfWrite(newPath);
      return newPath;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worksKey });
      qc.invalidateQueries({ queryKey: foldersKey });
    },
  });
}

export function useDeletePortfolioFolder() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderPath: string) => {
      const result = await deletePortfolioFolder(adapter, folderPath);
      watcher.markSelfWrite(`${PORTFOLIO_DIR}/${folderPath}`);
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKey });
      qc.invalidateQueries({ queryKey: worksKey });
      qc.invalidateQueries({ queryKey: trashKey });
    },
  });
}

// 카테고리는 vault 카드의 frontmatter union 으로 자연 발생 (V0.7.3 — design-derived).
// master list 파일·코드 상수 없음. 호출처는 string[] 받아서 자동완성·필터·정렬에 사용.
// 빈 카드 (sync default) 가 만든 "other" 도 vault union 에 자연 포함됨.
export function usePortfolioCategories(): string[] {
  const worksQuery = usePortfolioWorks();
  return useMemo(
    () => deriveCategoryUnion(worksQuery.data ?? []),
    [worksQuery.data],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// useGhSync — local mutable run state. design 1B: 시작/완료/중단 상태 노출.

export interface GhSyncProgress {
  running: boolean;
  current: number;
  total: number;
  error: Error | null;
  lastResult: SyncPortfolioResult | null;
}

// readSyncState 가 hang 되면 5초 후 full sync 로 fallback. 로컬 서버 요청 응답이
// 영영 안 오는 경우 (dev 중 vite full-reload·서버 재시작 과 동시 sync) 의
// stuck 방어. since 만 손해.
const READ_SYNC_STATE_TIMEOUT_MS = 5000;

async function readSyncStateWithTimeout(
  adapter: Parameters<typeof readSyncState>[0],
): Promise<Awaited<ReturnType<typeof readSyncState>> | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      readSyncState(adapter),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READ_SYNC_STATE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useGhSync() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  const [state, setState] = useState<GhSyncProgress>({
    running: false,
    current: 0,
    total: 0,
    error: null,
    lastResult: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  // 매 run() 마다 증가. cancel() 도 증가시켜 in-flight 의 setState 를 무효화.
  // hang 된 invoke 가 뒤늦게 resolve 되어도 stale 라 무시 → state/UI 깨끗.
  const callIdRef = useRef(0);

  const run = useCallback(
    async (
      opts: Pick<SyncPortfolioOpts, "since"> & { incremental?: boolean } = {},
    ) => {
      // race 차단 — 이미 sync 진행 중이면 새 호출 무시. background auto-sync + 사용자 클릭
      // 동시 발생 시 in-flight 요청 충돌 (응답 뒤섞임) 회피.
      if (runningRef.current) return null;
      runningRef.current = true;
      const myCallId = ++callIdRef.current;

      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({
        ...s,
        running: true,
        current: 0,
        total: 0,
        error: null,
      }));
      try {
        // incremental: hook 안에서 last_sync 읽어 since 결정. 호출처 closure 단순화.
        let since = opts.since;
        if (opts.incremental && !since) {
          const st = await readSyncStateWithTimeout(adapter);
          // null = timeout 또는 read 실패 → full sync (since 없이) 로 fallback.
          if (st?.last_sync) {
            since = new Date(
              new Date(st.last_sync).getTime() - 24 * 60 * 60 * 1000,
            )
              .toISOString()
              .slice(0, 10);
          }
        }
        const result = await syncPortfolio(adapter, {
          since,
          signal: controller.signal,
          onProgress: (current, total) => {
            // stale callId 면 progress 도 무시 — cancel 이후 hang 풀린 호출 보호.
            if (callIdRef.current !== myCallId) return;
            setState((s) => ({ ...s, current, total }));
          },
        });
        // success: callId 가 여전히 본인 것이어야 state 반영. cancel() 후라면 skip.
        if (callIdRef.current === myCallId) {
          setState({
            running: false,
            current: result.total,
            total: result.total,
            error: null,
            lastResult: result,
          });
          qc.invalidateQueries({ queryKey: worksKey });
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (callIdRef.current === myCallId) {
          setState((s) => ({ ...s, running: false, error }));
        }
        throw err;
      } finally {
        if (callIdRef.current === myCallId) {
          abortRef.current = null;
          runningRef.current = false;
        }
      }
    },
    [adapter, qc],
  );

  // 사용자 manual 취소 또는 stuck 회복. abort 가 hung 서버 요청을 못 풀어도
  // callId 를 advance + runningRef 리셋해 다음 click 받음. 뒤늦게 resolve 되는
  // stale promise 의 setState 는 callId 가드로 무시.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    callIdRef.current++;
    runningRef.current = false;
    abortRef.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  // 사이드바 inline 에러 row 의 X 닫기. run() 시작 시 error: null 로 자동 reset 되므로
  // 다음 sync 시 같은 에러는 다시 표시됨.
  const dismissError = useCallback(() => {
    setState((s) => (s.error ? { ...s, error: null } : s));
  }, []);

  return { state, run, cancel, dismissError };
}
