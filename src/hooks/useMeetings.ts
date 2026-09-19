import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createMeeting,
  createMeetingFolder,
  deleteMeeting,
  deleteMeetingFolder,
  emptyTrash,
  getMeeting,
  listDeletedMeetings,
  listMeetingFolders,
  listMeetings,
  moveMeeting,
  moveMeetingFolder,
  purgeMeeting,
  renameMeetingFolder,
  restoreMeeting,
  updateMeeting,
  type Meeting,
  type MeetingCreateInput,
  type MeetingUpdate,
} from "../api/meetings";
import { summaryPath, transcriptPath } from "../lib/vault/scan";
import { useVault } from "../lib/vault/useVault";
import type { VaultWatcher } from "../lib/vault/watcher";
import { setStoredViewMode } from "./useViewMode";
import { OfflineCacheMissError } from "../lib/vault/readCache";

// 한 회의는 메인 + 2 sidecar 파일이라 자기 write 마크도 셋 다. path 기반.
function markMeetingSelfWrite(watcher: VaultWatcher, path: string): void {
  watcher.markSelfWrite(path);
  watcher.markSelfWrite(transcriptPath(path));
  watcher.markSelfWrite(summaryPath(path));
}

const meetingsKey = ["meetings"] as const;
const deletedMeetingsKey = ["meetings", "deleted"] as const;
// detail cache key 는 uid (frontmatter 의 영구 id) 기반. path rename 에 영향 받지 않음.
const meetingKey = (uid: string) => ["meetings", "detail", uid] as const;

// 모든 메모 쓰기 mutation 의 공유 scope. 같은 scope.id 끼리 TanStack 이 순차 실행 →
// 생성·제목 rename·이동·삭제·폴더 op 가 서로(그리고 본문 편집과) 직렬화된다.
// 디렉토리 listing 을 건드리는 op 들은 "exists 검사 → write" 사이 TOCTOU 가 있어
// 빠른 연속 작업 시 거짓 TitleConflictError / 파일 엇갈림이 났는데, 직렬화로 차단.
// 본문 편집(useUpdateMeeting)도 제목 변경 시 rename 을 유발하므로 같은 scope 에 둔다.
// 단일 사용자라 cross-memo 병렬 손실은 무의미하고, 에디터는 로컬 state 로 렌더돼
// 직렬화가 타이핑 체감에 영향 없음 (mutation 은 백그라운드 persist).
const VAULT_WRITE_SCOPE = { id: "vault:structural" } as const;

// uid → file path lookup. list query cache 에 의존. list 가 active 면 항상 valid.
function uidToPath(qc: QueryClient, uid: string): string | undefined {
  const list = qc.getQueryData<Meeting[]>(meetingsKey);
  return list?.find((m) => m.uid === uid)?.id;
}

// 새 메모 직후 자동 focus 용 1회성 flag. useCreateMeeting 가 set, MeetingForm 가 consume.
let _justCreatedMeetingUid: string | null = null;
export function consumeJustCreatedMeetingUid(uid: string): boolean {
  if (_justCreatedMeetingUid === uid) {
    _justCreatedMeetingUid = null;
    return true;
  }
  return false;
}

// patch 형식 (string | null | array) 을 Meeting 의 정규 type 으로 변환.
function normalizeAttendeesPatch(v: MeetingUpdate["attendees"]): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v.filter((s): s is string => typeof s === "string");
  }
  if (typeof v === "string") {
    return v.trim() === ""
      ? []
      : v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function applyOptimisticPatch(prev: Meeting, patch: MeetingUpdate): Meeting {
  const out: Meeting = { ...prev };
  if (patch.title !== undefined) out.title = patch.title ?? "";
  if (patch.date !== undefined) out.date = patch.date ?? null;
  if (patch.time !== undefined) out.time = patch.time ?? null;
  if (patch.attendees !== undefined) {
    out.attendees = normalizeAttendeesPatch(patch.attendees);
  }
  if (patch.tags !== undefined) out.tags = patch.tags ?? [];
  if (patch.pinned !== undefined) out.pinned = patch.pinned ?? false;
  if (patch.content !== undefined) out.content = patch.content ?? "";
  if (patch.transcript !== undefined) out.transcript = patch.transcript ?? "";
  if (patch.summary !== undefined) out.summary = patch.summary ?? "";
  return out;
}

export function useMeetings() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: meetingsKey,
    queryFn: () => listMeetings(adapter),
    enabled: isReady,
  });
}


// vault 의 notes/ 안 모든 폴더 (빈 폴더 포함). queryKey prefix 가 ["meetings"]
// 라 watcher 의 list invalidation 이 같이 trigger — 폴더 변경 시 자동 refetch.
const meetingFoldersKey = ["meetings", "folders"] as const;
export function useMeetingFolders() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: meetingFoldersKey,
    queryFn: () => listMeetingFolders(adapter),
    enabled: isReady,
  });
}

export function useCreateMeetingFolder() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: (folderPath: string) => createMeetingFolder(adapter, folderPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: meetingFoldersKey });
    },
  });
}

// 폴더 이름 변경 — 부모 path 유지, 안 메모는 자동 따라옴. invalidate 만 — 옛/새
// path 둘 다 watcher 가 외부 변경으로 잡을 수 있지만 list refetch 가 결국 같은
// 결과로 수렴해서 harmless. 사용자 체감 0.
export function useRenameMeetingFolder() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: ({ folder, newName }: { folder: string; newName: string }) =>
      renameMeetingFolder(adapter, folder, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: meetingsKey });
      qc.invalidateQueries({ queryKey: meetingFoldersKey });
    },
  });
}

// 폴더를 다른 폴더 아래로 이동 (위계 DnD). 안 메모·sub-folder 통째 따라옴.
// rename 과 동일하게 invalidate 만 — path 가 통째 바뀌어도 detail cache 는 uid 기반이라
// 유효하고, mutation 들이 mutationFn 시점에 list 에서 현재 path 를 lookup 한다.
export function useMoveMeetingFolder() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: ({ folder, destParent }: { folder: string; destParent: string }) =>
      moveMeetingFolder(adapter, folder, destParent),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: meetingsKey });
      qc.invalidateQueries({ queryKey: meetingFoldersKey });
    },
  });
}

// 폴더 삭제 — 안 메모 휴지통 이동 + 디스크 dir 정리. 호출자가 confirm 책임.
export function useDeleteMeetingFolder() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: (folderPath: string) => deleteMeetingFolder(adapter, folderPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: meetingsKey });
      qc.invalidateQueries({ queryKey: deletedMeetingsKey });
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useDeletedMeetings() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: deletedMeetingsKey,
    queryFn: () => listDeletedMeetings(adapter),
    enabled: isReady,
  });
}

export function useMeeting(uid: string | undefined) {
  const { adapter, isReady } = useVault();
  const qc = useQueryClient();
  // list cache 가 채워진 뒤에만 detail query 실행. 그렇지 않으면 새로고침 시
  // hash 에서 selectedMeetingId 가 즉시 set 되어 detail queryFn 이 list 보다 먼저
  // 돌고, uidToPath 가 undefined 를 돌려주는 바람에 detail 캐시가 null 로 굳어
  // 본문이 영구히 안 뜸. queryKey 동일이라 useQuery 가 dedupe.
  const list = useMeetings();
  return useQuery({
    queryKey: uid ? meetingKey(uid) : ["meetings", "none"],
    queryFn: async () => {
      if (!uid) return null;
      const path = uidToPath(qc, uid);
      // list cache 에 uid 없으면 throw → retry. list refetch 가 끝나는 사이
      // 일시 누락이면 자동 복구. (정말 사라진 meeting 은 retry 다 실패 후 error UI)
      if (!path) throw new Error(`meeting uid not in list: ${uid}`);
      return getMeeting(adapter, path);
    },
    enabled: !!uid && isReady && list.isSuccess,
    // OfflineCacheMissError 는 오프라인 + 캐시 없음을 확정 신호로 전달 — retry 불필요.
    // 다른 에러는 기존 동작(iCloud sync 중 stuck → 재시도 후 복구)을 유지.
    retry: (failureCount, err) => {
      if (err instanceof OfflineCacheMissError) return false;
      return failureCount < 3;
    },
  });
}

// uid 로 full Meeting (본문/음성기록/요약 포함) 을 1회성 fetch. 사이드바 컨텍스트
// 메뉴의 마크다운 복사·내보내기처럼 list 항목(본문 빈 string)만으론 부족한 경우에 사용.
// detail query cache 를 채우진 않고 disk 에서 바로 읽음 (가볍게 read-and-discard).
export function useGetFullMeeting() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useCallback(
    async (uid: string): Promise<Meeting> => {
      const path = uidToPath(qc, uid);
      if (!path) throw new Error(`meeting not found: uid=${uid}`);
      return getMeeting(adapter, path);
    },
    [adapter, qc],
  );
}

export function useCreateMeeting() {
  const { adapter, watcher, activeVaultId } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async (input: MeetingCreateInput) => {
      const created = await createMeeting(adapter, input);
      markMeetingSelfWrite(watcher, created.id);
      _justCreatedMeetingUid = created.uid;
      // 새 메모는 본문 편집 모드로 열리도록 — MeetingForm mount 전에 vault 전역
      // viewMode 를 edit 로 써둔다 (mount 후 setState 는 useViewMode 초기화와 race).
      setStoredViewMode(activeVaultId, "edit");
      return created;
    },
    onSuccess: (created) => {
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev ? [created, ...prev] : [created],
      );
      qc.setQueryData(meetingKey(created.uid), created);
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useUpdateMeeting(uid: string) {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    // 모든 메모 쓰기와 공유하는 scope 로 직렬화 — 제목 변경 시 disk rename 을 유발하므로
    // 생성·이동 등 다른 namespace op 와도 순서가 보장돼야 한다 (uid 단위로는 부족).
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async (patch: MeetingUpdate) => {
      // uid 는 영구 — list cache 에서 현재 path 조회.
      const path = uidToPath(qc, uid);
      if (!path) throw new Error(`meeting not found: uid=${uid}`);
      markMeetingSelfWrite(watcher, path);
      const updated = await updateMeeting(adapter, path, patch);
      if (updated.id !== path) {
        // rename 발생 — 새 path 도 self-write 마크.
        markMeetingSelfWrite(watcher, updated.id);
      }
      return updated;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: meetingKey(uid) });
      const prevDetail = qc.getQueryData<Meeting>(meetingKey(uid));
      if (prevDetail) {
        qc.setQueryData(meetingKey(uid), applyOptimisticPatch(prevDetail, patch));
      }
      qc.setQueryData<Meeting[]>(meetingsKey, (curr) =>
        curr?.map((m) => (m.uid === uid ? applyOptimisticPatch(m, patch) : m)),
      );
      return { prevDetail };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(meetingKey(uid), ctx.prevDetail);
      qc.invalidateQueries({ queryKey: meetingsKey });
    },
    onSuccess: (updated) => {
      // uid 는 변하지 않음 — cache key 그대로. path 만 변할 수 있고 list 의 그 entry 의 id 가 갱신됨.
      // 옛 path 의 cache 청소 / hash 갱신 / 옛 detail query 보존 같은 복잡 흐름 다 사라짐.
      qc.setQueryData(meetingKey(uid), updated);
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev?.map((m) => (m.uid === uid ? updated : m)),
      );
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

// 사이드바 즐겨찾기 토글 — uid 를 mutate 시점에 받음 (메모마다 hook instance 안 만들고
// 컨텍스트 메뉴에서 직접 호출). 공유 scope 로 다른 메모 쓰기와 직렬화.
export function useTogglePinMeeting() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async ({ uid, pinned }: { uid: string; pinned: boolean }) => {
      const path = uidToPath(qc, uid);
      if (!path) throw new Error(`meeting not found: uid=${uid}`);
      markMeetingSelfWrite(watcher, path);
      return updateMeeting(adapter, path, { pinned });
    },
    onMutate: async ({ uid, pinned }) => {
      await qc.cancelQueries({ queryKey: meetingKey(uid) });
      const prevDetail = qc.getQueryData<Meeting>(meetingKey(uid));
      if (prevDetail) {
        qc.setQueryData(meetingKey(uid), { ...prevDetail, pinned });
      }
      qc.setQueryData<Meeting[]>(meetingsKey, (curr) =>
        curr?.map((m) => (m.uid === uid ? { ...m, pinned } : m)),
      );
      return { prevDetail };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(meetingKey(vars.uid), ctx.prevDetail);
      qc.invalidateQueries({ queryKey: meetingsKey });
    },
    onSuccess: (updated) => {
      qc.setQueryData(meetingKey(updated.uid), updated);
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev?.map((m) => (m.uid === updated.uid ? updated : m)),
      );
    },
  });
}

// 폴더 이동 — title 유지, path 만 변경. uid 는 영구라 detail cache 그대로.
// 옛/새 path 둘 다 self-write 마크 — watcher 가 우리 변경을 외부 변경으로 오인 X.
export function useMoveMeeting() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async ({ uid, folder }: { uid: string; folder: string }) => {
      const path = uidToPath(qc, uid);
      if (!path) throw new Error(`meeting not found: uid=${uid}`);
      markMeetingSelfWrite(watcher, path);
      const moved = await moveMeeting(adapter, path, folder);
      if (moved.id !== path) {
        markMeetingSelfWrite(watcher, moved.id);
      }
      return moved;
    },
    onSuccess: (moved) => {
      qc.setQueryData(meetingKey(moved.uid), moved);
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev?.map((m) => (m.uid === moved.uid ? moved : m)),
      );
    },
  });
}

export function useDeleteMeeting() {
  const { adapter, watcher } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: async (uid: string) => {
      const path = uidToPath(qc, uid);
      if (!path) throw new Error(`meeting not found: uid=${uid}`);
      await deleteMeeting(adapter, path);
      markMeetingSelfWrite(watcher, path);
      return uid;
    },
    onSuccess: (uid) => {
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev?.filter((m) => m.uid !== uid),
      );
      qc.removeQueries({ queryKey: meetingKey(uid) });
      qc.invalidateQueries({ queryKey: deletedMeetingsKey });
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useRestoreMeeting() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: (trashId: string) => restoreMeeting(adapter, trashId),
    onSuccess: (restored, trashId) => {
      qc.setQueryData<Meeting[]>(deletedMeetingsKey, (prev) =>
        prev?.filter((m) => m.id !== trashId),
      );
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) =>
        prev ? [restored, ...prev] : [restored],
      );
      qc.setQueryData(meetingKey(restored.uid), restored);
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function usePurgeMeeting() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: (trashId: string) => purgeMeeting(adapter, trashId),
    onSuccess: (_void, trashId) => {
      qc.setQueryData<Meeting[]>(deletedMeetingsKey, (prev) =>
        prev?.filter((m) => m.id !== trashId),
      );
    },
  });
}

export function useEmptyTrash() {
  const { adapter } = useVault();
  const qc = useQueryClient();
  return useMutation({
    scope: VAULT_WRITE_SCOPE,
    mutationFn: () => emptyTrash(adapter),
    onSuccess: () => {
      qc.setQueryData<Meeting[]>(deletedMeetingsKey, []);
    },
  });
}
