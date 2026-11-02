import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  archiveRecording,
  linkRecording,
  listRecordings,
  readRecordingTranscript,
  unarchiveRecording,
  unlinkRecording,
  type LinkResponse,
  type RecordingEntry,
} from "../api/recordings";
import type { Meeting } from "../api/meetings";
import { flushMeetingDoc, resetMeetingDoc } from "../components/meetings/docReset";
import { useVault } from "../lib/vault/useVault";
import {
  anyProcessing,
  collectKnownBases,
  countTodayRecordings,
  mergeRecordings,
  type RecordingItem,
} from "../lib/recordings/merge";
import { useDeletedMeetings, useMeetings, VAULT_WRITE_SCOPE } from "./useMeetings";

export const recordingsKey = ["recordings"] as const;
const meetingsKey = ["meetings"] as const;

/**
 * 녹음 목록 + 메모 역참조 병합. 메모 목록·휴지통 목록이 정리된 뒤에만 요청한다 —
 * `known` 이 비어 있으면 서버가 연결된 녹음까지 전부 orphan 검사(brain 전체 walk)를 하기 때문.
 * 처리 중인 job 이 있으면 3초마다 다시 읽는다.
 */
export function useRecordings() {
  const meetingsQ = useMeetings();
  const trashQ = useDeletedMeetings();
  const memos = meetingsQ.data;
  // 휴지통 로드 실패는 빈 목록으로 진행 (휴지통 판정만 빠짐).
  const trashed = trashQ.data ?? (trashQ.isError ? [] : undefined);
  const known = useMemo(
    () => (memos && trashed ? collectKnownBases(memos, trashed) : null),
    [memos, trashed],
  );
  const q = useQuery({
    queryKey: [...recordingsKey, known?.join(",") ?? ""],
    queryFn: () => listRecordings(known ?? []),
    enabled: known !== null,
    refetchInterval: (query) => (anyProcessing(query.state.data) ? 3000 : false),
    // known 이 바뀌면(link 후 audio: 추가) key 가 바뀐다 — 그 사이 목록이 비어 깜빡이지 않게.
    placeholderData: (prev) => prev,
  });
  const items = useMemo<RecordingItem[] | undefined>(
    () => (q.data && memos && trashed ? mergeRecordings(q.data, memos, trashed) : undefined),
    [q.data, memos, trashed],
  );
  return {
    items,
    isLoading: known === null || q.isLoading,
    isError: q.isError || meetingsQ.isError,
    error: q.error ?? meetingsQ.error,
    refetch: q.refetch,
  };
}

/** 오늘 대시보드 "처리할 녹음 N개". 로딩 중·실패면 0 (줄 숨김). */
export function useTodayRecordingCount(): number {
  const { items } = useRecordings();
  return items ? countTodayRecordings(items) : 0;
}

/** 연결 전 전사본 미리보기 (읽기 전용). 연결됨이면 메모 쪽에서 본다. */
export function useRecordingTranscript(entry: RecordingEntry | undefined, enabled: boolean) {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: [
      ...recordingsKey,
      "transcript",
      entry?.base ?? "",
      entry?.hasTxt ?? false,
      entry?.stt.done ?? false,
      entry?.stt.moved ?? false,
    ],
    queryFn: () => (entry ? readRecordingTranscript(adapter, entry) : null),
    enabled: !!entry && enabled && isReady,
  });
}

// ── mutations ────────────────────────────────────────────────────────────────

function uidToPath(qc: QueryClient, uid: string): string | undefined {
  return qc.getQueryData<Meeting[]>(meetingsKey)?.find((m) => m.uid === uid)?.id;
}

function afterMemoChange(qc: QueryClient, meeting: Meeting, created = false) {
  // 열린 폼(또는 남아 있는 history cache)을 디스크 값으로 다시 시작 — 이사한 섹션을 폼이 덮어쓰지 않게.
  resetMeetingDoc(meeting.uid, meeting);
  qc.setQueryData(["meetings", "detail", meeting.uid], meeting);
  qc.setQueryData<Meeting[]>(meetingsKey, (prev) => {
    if (!prev) return prev;
    const has = prev.some((m) => m.uid === meeting.uid);
    if (has) return prev.map((m) => (m.uid === meeting.uid ? meeting : m));
    // 새 메모는 바로 목록에 — 생성 직후 그 메모로 이동할 때 useMeeting 이 uid 를 찾도록.
    return created ? [meeting, ...prev] : prev;
  });
}

function invalidateAll(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: recordingsKey });
  void qc.invalidateQueries({ queryKey: meetingsKey });
}

export type LinkVars =
  | { base: string; memoUid: string }
  // 메모 목록에 없는 메모(`_` 폴더 등) — "연결 정보 없는 섹션" 복구용. path 그대로 보낸다.
  | { base: string; memoPath: string }
  | { base: string; newMemo: { title: string; folder?: string } };

/**
 * 순서 보장 (열린 폼 vs 서버 사이드카 수정):
 * 1. mutate 직전에 `flushMeetingDoc(uid)` — 열린 폼의 debounce 중 편집을 저장 mutation 으로 먼저 enqueue.
 * 2. link 는 메모 저장(useUpdateMeeting)과 같은 scope(`VAULT_WRITE_SCOPE`) → 그 저장들이 끝난 뒤 실행.
 * 3. 메모 path 는 mutationFn 시점에 uid 로 조회 — 앞선 저장이 제목 rename 을 했어도 새 path.
 * 4. 성공 후 `resetMeetingDoc` 으로 폼 history 를 디스크 값으로 재시작.
 */
export function useLinkRecording() {
  const qc = useQueryClient();
  const m = useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async (vars: LinkVars): Promise<LinkResponse> => {
      if ("newMemo" in vars) return linkRecording(vars.base, { newMemo: vars.newMemo });
      if ("memoPath" in vars) return linkRecording(vars.base, { memo: vars.memoPath });
      const memo = uidToPath(qc, vars.memoUid);
      if (!memo) throw new Error("메모를 찾을 수 없습니다. 메모 목록을 새로 고친 뒤 다시 시도하세요.");
      return linkRecording(vars.base, { memo });
    },
    onSuccess: (r) => afterMemoChange(qc, r.meeting, r.created),
    onSettled: () => invalidateAll(qc),
  });
  return {
    ...m,
    link: (vars: LinkVars) => {
      if ("memoUid" in vars) flushMeetingDoc(vars.memoUid);
      return m.mutateAsync(vars);
    },
  };
}

export function useUnlinkRecording() {
  const qc = useQueryClient();
  const m = useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async (vars: { base: string; memoUid: string }) => {
      const memo = uidToPath(qc, vars.memoUid);
      if (!memo) throw new Error("메모를 찾을 수 없습니다. 메모 목록을 새로 고친 뒤 다시 시도하세요.");
      return unlinkRecording(vars.base, memo);
    },
    onSuccess: (r) => afterMemoChange(qc, r.meeting),
    onSettled: () => invalidateAll(qc),
  });
  return {
    ...m,
    unlink: (vars: { base: string; memoUid: string }) => {
      flushMeetingDoc(vars.memoUid);
      return m.mutateAsync(vars);
    },
  };
}

/**
 * "다른 메모로 이동" = 연결 해제 + 연결. 두 단계 모두 같은 scope 라 순서대로 실행.
 * 해제가 섹션 헤딩을 못 찾으면(textKept) 전사본이 옛 메모에 남아 있으므로 연결을 멈춘다 —
 * 그대로 연결하면 서버가 whisper 초벌(tr.txt)을 새 메모로 승격해 전사본이 두 벌이 된다.
 */
export function useMoveRecording() {
  const unlink = useUnlinkRecording();
  const link = useLinkRecording();
  return {
    isPending: unlink.isPending || link.isPending,
    move: async (vars: { base: string; fromUid: string; toUid: string }) => {
      const u = await unlink.unlink({ base: vars.base, memoUid: vars.fromUid });
      if (u.textKept) return { unlink: u, link: null };
      const l = await link.link({ base: vars.base, memoUid: vars.toUid });
      return { unlink: u, link: l };
    },
  };
}

export function useArchiveRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (base: string) => archiveRecording(base),
    onSettled: () => void qc.invalidateQueries({ queryKey: recordingsKey }),
  });
}

export function useUnarchiveRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (base: string) => unarchiveRecording(base),
    onSettled: () => void qc.invalidateQueries({ queryKey: recordingsKey }),
  });
}
