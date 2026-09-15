import {
  Plus,
  BookOpen,
  HelpCircle,
  X,
  Trash2,
  ArrowUpDown,
  Check,
  Pencil,
  XCircle,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Star,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useMeetings,
  useMeetingFolders,
  useCreateMeeting,
  useCreateMeetingFolder,
  useDeleteMeeting,
  useDeleteMeetingFolder,
  useGetFullMeeting,
  useMoveMeeting,
  useMoveMeetingFolder,
  useRenameMeetingFolder,
  useTogglePinMeeting,
} from "../../hooks/useMeetings";
import {
  copyMeetingMarkdown,
  meetingToMarkdownInput,
} from "../../lib/meetingExport";
import type { MeetingMarkdownInput } from "../../lib/markdown";
import { MeetingMenuItems } from "../meetings/MeetingMenuItems";
import { MeetingExportModal } from "../meetings/MeetingExportModal";
import { meetingFolder } from "../../api/meetings";
import { useMeetingSort, type MeetingSortKey } from "../../hooks/useMeetingSort";
import { buildMeetingSortComparator } from "../../lib/meetingSort";
import { useTasks } from "../../hooks/useTasks";
import {
  useTaskProjects,
  useCreateProject,
  useDeleteProject,
} from "../../hooks/useTaskProjects";
import type { TaskProject } from "../../api/taskProjects";
import {
  useActiveRoutines,
  useArchivedRoutines,
  useToggleRoutineDay,
} from "../../hooks/useRoutines";
import type { Meeting } from "../../api/meetings";
import type { Routine } from "../../api/routines";
import { todayIso } from "../../lib/dates";
import { formatError } from "../../lib/errors";
import { CheckboxButton } from "../tasks/CheckboxButton";
import { MeetingsTreeView } from "../meetings/MeetingsTreeView";
import { MoveFolderModal } from "../meetings/MoveFolderModal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { FilterItem } from "../common/FilterItem";
import { Popover } from "../common/Popover";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../Toast";

/* ── Meetings Side Panel ── */

type MeetingsPanelProps = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  // 사이드바 빈 공간 클릭 = 선택 해제. 트리 아래 빈 영역만 (행 클릭은 onSelect).
  onDeselect?: () => void;
  // 폴더 자동 펼침 — App 이 단일 소유. nonce 바뀌면 트리가 revealPath(+조상) 펼침.
  // 메모/폴더 생성 시 onRevealFolder 로 App 에 요청 (Cmd+N 도 App 이 직접 호출).
  revealPath?: string;
  revealNonce?: number;
  onRevealFolder: (path: string) => void;
  // 마크다운 도움말 패널 — open 상태는 App 소유, footer 토글 버튼이 제어.
  markdownHelpOpen?: boolean;
  onMarkdownHelpClose?: () => void;
};

export function MeetingsSidePanel({
  selectedId,
  onSelect,
  onDeselect,
  revealPath,
  revealNonce,
  onRevealFolder,
  markdownHelpOpen,
  onMarkdownHelpClose,
}: MeetingsPanelProps) {
  const { data, isLoading } = useMeetings();
  const { data: folders } = useMeetingFolders();
  const createMutation = useCreateMeeting();
  const createFolderMutation = useCreateMeetingFolder();
  const deleteFolderMutation = useDeleteMeetingFolder();
  const deleteMeetingMutation = useDeleteMeeting();
  const renameFolderMutation = useRenameMeetingFolder();
  const moveMutation = useMoveMeeting();
  const moveFolderMutation = useMoveMeetingFolder();
  const togglePinMutation = useTogglePinMeeting();
  const getFullMeeting = useGetFullMeeting();
  const toast = useToast();
  const [sortKey, setSortKey] = useMeetingSort();
  const [contextMenu, setContextMenu] = useState<{
    meetingId: string;
    x: number;
    y: number;
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    folder: string;
    x: number;
    y: number;
  } | null>(null);
  const [moveModalFor, setMoveModalFor] = useState<string | null>(null);
  // 폴더 행 in-place 편집 — 옵시디안 패턴. 새 폴더 만든 직후 자동 진입 / 우클릭
  // "이름 변경" 으로도 진입. value 가 비면 commit 시 cancel 로 처리.
  const [editingFolder, setEditingFolder] = useState<
    { folder: string; value: string } | null
  >(null);
  // 폴더 삭제 confirm 모달 target. null = 닫힘. window.confirm 은 Tauri WebView 에서
  // noop 통과되어 안전하지 않아 ConfirmDialog 모달로 대체.
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<
    { folder: string; total: number; pinned: number } | null
  >(null);
  // 메모 삭제 confirm target. window.confirm 은 Tauri WebView 에서 신뢰 못해
  // ConfirmDialog 모달 경유 (폴더 삭제와 동일 패턴).
  const [deleteMeetingTarget, setDeleteMeetingTarget] = useState<
    { uid: string; title: string } | null
  >(null);
  // 내보내기 섹션 선택 모달 target — full Meeting fetch 후 set.
  const [exportTarget, setExportTarget] = useState<MeetingMarkdownInput | null>(
    null,
  );

  // 메모 정렬 — 폴더 안에서만 적용. 폴더 위계는 alphabetic 고정 (정렬 popover 무관).
  // App.tsx (삭제 후 자동 선택, Cmd+↑/↓) 와 같은 comparator 공유 — buildMeetingSortComparator.
  const sortComparator = useMemo(
    () => buildMeetingSortComparator(sortKey),
    [sortKey],
  );

  // 컨텍스트 메뉴 닫기 — 바깥 클릭 / ESC / scroll. 메모 + 폴더 컨텍스트 메뉴 공통.
  useEffect(() => {
    if (!contextMenu && !folderContextMenu) return;
    function close() {
      setContextMenu(null);
      setFolderContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // mousedown 으로 (클릭 시작 시점에 즉시 닫음 — child 메뉴 항목의 click 도
    // 자기 onClick 안에서 닫기 trigger 함)
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu, folderContextMenu]);

  async function handleCreate() {
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      // 현재 선택된 메모가 있으면 그 메모의 폴더에 생성 (없으면 root).
      const current = (data ?? []).find((mt) => mt.uid === selectedId);
      const folder = current ? meetingFolder(current.id) : "";
      const created = await createMutation.mutateAsync({
        title: null,
        date: `${y}-${m}-${d}`,
        time: null,
        attendees: null,
        content: "",
        summary: null,
        folder,
      });
      onRevealFolder(folder); // 그 폴더가 접혀 있었으면 펼쳐서 새 메모 노출
      onSelect(created.uid);
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // 옵시디안 패턴: "+폴더" 클릭 → "새 폴더" default 이름으로 즉시 생성 → 그 폴더
  // 행에 인라인 rename 자동 진입. 이미 "새 폴더" 가 있으면 "새 폴더 2" 식으로 N
  // 증가. 빠른 생성 + 즉시 이름 입력 = 한 단계 흐름.
  async function handleCreateFolder() {
    // 현재 선택된 메모가 있으면 그 폴더 안에 생성 (없으면 root).
    const current = (data ?? []).find((mt) => mt.uid === selectedId);
    const parent = current ? meetingFolder(current.id) : "";
    const base = "새 폴더";
    // 같은 부모 안 직속 자식 폴더 이름만 모아 충돌 회피 (notes/ prefix 제거).
    const prefix = parent ? `${parent}/` : "";
    const siblings = new Set(
      (folders ?? [])
        .map((f) => f.replace(/^notes\//, ""))
        .filter((rel) => rel.startsWith(prefix))
        .map((rel) => rel.slice(prefix.length))
        .filter((rest) => rest !== "" && !rest.includes("/")),
    );
    let name = base;
    let n = 2;
    while (siblings.has(name)) {
      name = `${base} ${n}`;
      n++;
    }
    const relPath = parent ? `${parent}/${name}` : name;
    try {
      const full = await createFolderMutation.mutateAsync(relPath);
      const createdRel = full.replace(/^notes\//, "");
      const createdName = createdRel.slice(createdRel.lastIndexOf("/") + 1);
      onRevealFolder(parent); // 부모 폴더 펼쳐서 새 폴더 행 노출
      // 즉시 rename mode 로. 입력은 폴더 행 안 input (MeetingsTreeView 가 렌더).
      // value 는 마지막 segment 만 (편집할 이름), folder 는 full rel path.
      setEditingFolder({ folder: createdRel, value: createdName });
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  function handleContextMenu(meetingId: string, x: number, y: number) {
    setContextMenu({ meetingId, x, y });
  }

  function handleFolderContextMenu(folder: string, x: number, y: number) {
    setFolderContextMenu({ folder, x, y });
  }

  // 폴더 안 메모 카운트 — useMeetings list 에서 derive. sub-folder 도 포함.
  function countInFolder(folder: string): number {
    if (!data) return 0;
    return data.filter((m) => {
      const f = meetingFolder(m.id);
      return f === folder || f.startsWith(folder + "/");
    }).length;
  }

  // 같은 범위 안 고정 메모 카운트. 사용자가 폴더 삭제 시 pinned 메모가 그 안에
  // 들어있는 걸 까먹는 케이스 방어 — confirm 모달에 별도 줄로 강조.
  function countPinnedInFolder(folder: string): number {
    if (!data) return 0;
    return data.filter((m) => {
      if (!m.pinned) return false;
      const f = meetingFolder(m.id);
      return f === folder || f.startsWith(folder + "/");
    }).length;
  }

  function openRenameInput(folder: string) {
    const lastSeg = folder.split("/").pop() ?? folder;
    setEditingFolder({ folder, value: lastSeg });
  }

  async function commitEditingFolder() {
    if (!editingFolder) return;
    const { folder, value } = editingFolder;
    const lastSeg = folder.split("/").pop() ?? folder;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === lastSeg) {
      setEditingFolder(null);
      return;
    }
    try {
      await renameFolderMutation.mutateAsync({ folder, newName: trimmed });
      setEditingFolder(null);
    } catch (e) {
      // 실패 시 input 닫고 원래 이름 복원 — server data 가 list 새로고침 시 그대로.
      // 에러는 우측하단 toast 로.
      setEditingFolder(null);
      toast.show(formatError(e));
    }
  }

  function handleDeleteFolder(folder: string) {
    setDeleteFolderTarget({
      folder,
      total: countInFolder(folder),
      pinned: countPinnedInFolder(folder),
    });
  }

  async function performDeleteFolder() {
    if (!deleteFolderTarget) return;
    const target = deleteFolderTarget;
    setDeleteFolderTarget(null);
    try {
      await deleteFolderMutation.mutateAsync(target.folder);
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // DnD drop 직접 처리 (모달 안 거치고). 충돌 시 toast.
  async function handleMoveDrop(uid: string, folder: string) {
    try {
      await moveMutation.mutateAsync({ uid, folder });
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // 폴더 DnD 이동 — 폴더를 다른 폴더(destParent "" = root) 아래로. 충돌/cycle 시 toast.
  // 가드(자기·자손·no-op)는 트리뷰가 drop 전에 거르지만 backend 도 재검증.
  async function handleFolderMoveDrop(srcFolder: string, destParent: string) {
    try {
      await moveFolderMutation.mutateAsync({ folder: srcFolder, destParent });
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // pinned 토글 — 컨텍스트 메뉴 / 별 아이콘 hover 클릭. uid 기반 (path rename 무관).
  async function handleTogglePin(uid: string, nextPinned: boolean) {
    try {
      await togglePinMutation.mutateAsync({ uid, pinned: nextPinned });
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // 마크다운 복사 / 내보내기 — list 항목은 본문이 빈 string 이라 full Meeting 을
  // 먼저 fetch (getFullMeeting). 본문(body) 섹션 기준 — 사이드바엔 활성 탭 개념 없음.
  async function handleCopyMeeting(uid: string) {
    try {
      const full = await getFullMeeting(uid);
      const ok = await copyMeetingMarkdown(meetingToMarkdownInput(full), "body");
      if (!ok) {
        toast.show(
          "복사에 실패했습니다. 권한 또는 환경을 확인하고 다시 시도하세요.",
        );
      }
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // 내보내기 — full Meeting fetch 후 섹션 선택 모달 오픈 (모달이 폴더 선택 + 파일 쓰기).
  async function handleExportMeeting(uid: string) {
    try {
      const full = await getFullMeeting(uid);
      setExportTarget(meetingToMarkdownInput(full));
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  async function performDeleteMeeting() {
    if (!deleteMeetingTarget) return;
    const { uid } = deleteMeetingTarget;
    setDeleteMeetingTarget(null);
    try {
      await deleteMeetingMutation.mutateAsync(uid);
      // 삭제한 게 현재 선택 메모면 선택 해제 (App 의 hash 정리 effect 가 이어받음).
      if (selectedId === uid) onDeselect?.();
    } catch (e) {
      toast.show(formatError(e));
    }
  }

  // 모달 경유 이동 — modal 안에서 commit 결과 throw 받아서 모달에 toast.
  async function handleMoveFromModal(folder: string) {
    if (!moveModalFor) return;
    const m = (data ?? []).find((x) => x.id === moveModalFor);
    if (!m) throw new Error("메모를 찾을 수 없습니다");
    await moveMutation.mutateAsync({ uid: m.uid, folder });
  }

  const moveModalMeeting = useMemo(() => {
    if (!moveModalFor || !data) return null;
    return data.find((m) => m.id === moveModalFor) ?? null;
  }, [moveModalFor, data]);

  // 컨텍스트 메뉴가 가리키는 메모 — pinned 라벨/icon 결정용 ("고정" vs "고정 해제").
  const contextMeeting = useMemo(() => {
    if (!contextMenu || !data) return null;
    return data.find((m) => m.id === contextMenu.meetingId) ?? null;
  }, [contextMenu, data]);

  // pinned 메모는 상단 PinnedSection + 트리 둘 다에 표시 (중복). 트리에서 빼면
  // 사용자가 "고정한 메모가 폴더에서 사라진 느낌" 으로 헷갈림. 옵시디안 bookmarks
  // 와 다른 선택. 정렬은 PinnedSection 만 별도 comparator 적용.
  const pinnedMeetings = useMemo(() => {
    return (data ?? []).filter((m) => m.pinned).sort(sortComparator);
  }, [data, sortComparator]);

  return (
    <div className="relative flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-4"
        style={{
          height: "var(--page-header-h)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2
          className="font-serif text-sm font-medium"
          style={{ color: "var(--ink)" }}
        >
          메모장
        </h2>
        <div className="flex items-center gap-0.5">
          <SortMenu value={sortKey} onChange={setSortKey} />
          <Button
            variant="icon"
            onClick={() => void handleCreateFolder()}
            disabled={createFolderMutation.isPending}
            title="새 폴더"
            className="disabled:opacity-50"
            style={{ color: "var(--sub)" }}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button
            variant="icon"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            title="새 메모장"
            className="disabled:opacity-50"
            style={{ color: "var(--sub)" }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onClick={(e) => {
          // 트리 아래 빈 영역(컨테이너 자기 자신)을 직접 클릭했을 때만 선택 해제.
          // 행/폴더 클릭은 자식에서 발생 → currentTarget 과 달라 무시.
          if (e.target === e.currentTarget && selectedId) onDeselect?.();
        }}
      >
        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md"
                style={{ backgroundColor: "var(--surface)" }}
              />
            ))}
          </div>
        ) : (!data || data.length === 0) && (!folders || folders.length === 0) ? (
          <Text
            variant="body"
            color="muted"
            as="div"
            className="px-4 py-8 text-center"
          >
            아직 메모장이 없어요
          </Text>
        ) : (
          <>
            {pinnedMeetings.length > 0 ? (
              <PinnedSection
                meetings={pinnedMeetings}
                selectedUid={selectedId}
                contextMeetingId={contextMenu?.meetingId ?? null}
                onSelect={onSelect}
                onContextMenu={handleContextMenu}
                onUnpin={(uid) => void handleTogglePin(uid, false)}
              />
            ) : null}
            <MeetingsTreeView
              meetings={data ?? []}
              extraFolders={folders ?? []}
              selectedUid={selectedId}
              contextMeetingId={contextMenu?.meetingId ?? null}
              contextFolder={folderContextMenu?.folder ?? null}
              sortMeetings={sortComparator}
              editingFolder={editingFolder}
              editingFolderPending={renameFolderMutation.isPending}
              onEditingFolderChange={(v) =>
                setEditingFolder((prev) => (prev ? { ...prev, value: v } : prev))
              }
              onEditingFolderCommit={() => void commitEditingFolder()}
              onEditingFolderCancel={() => setEditingFolder(null)}
              onSelect={onSelect}
              onContextMenu={handleContextMenu}
              onFolderContextMenu={handleFolderContextMenu}
              onMoveDrop={(uid, folder) => void handleMoveDrop(uid, folder)}
              onFolderMoveDrop={(src, dest) =>
                void handleFolderMoveDrop(src, dest)
              }
              revealPath={revealPath}
              revealNonce={revealNonce}
            />
          </>
        )}
      </div>

      {markdownHelpOpen ? (
        <MarkdownHelpPanel onClose={onMarkdownHelpClose ?? (() => {})} />
      ) : null}

      {contextMenu ? (
        <MeetingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          pinned={contextMeeting?.pinned ?? false}
          deleteDisabled={deleteMeetingMutation.isPending}
          onTogglePin={() => {
            const m = contextMeeting;
            setContextMenu(null);
            if (!m) return;
            void handleTogglePin(m.uid, !m.pinned);
          }}
          onMove={() => {
            setMoveModalFor(contextMenu.meetingId);
            setContextMenu(null);
          }}
          onCopy={() => {
            const m = contextMeeting;
            setContextMenu(null);
            if (m) void handleCopyMeeting(m.uid);
          }}
          onExport={() => {
            const m = contextMeeting;
            setContextMenu(null);
            if (m) void handleExportMeeting(m.uid);
          }}
          onDelete={() => {
            const m = contextMeeting;
            setContextMenu(null);
            if (m)
              setDeleteMeetingTarget({
                uid: m.uid,
                title: m.title?.trim() || "(제목 없음)",
              });
          }}
        />
      ) : null}

      {folderContextMenu ? (
        <FolderContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          onRename={() => {
            const f = folderContextMenu.folder;
            setFolderContextMenu(null);
            openRenameInput(f);
          }}
          onDelete={() => {
            const f = folderContextMenu.folder;
            setFolderContextMenu(null);
            void handleDeleteFolder(f);
          }}
        />
      ) : null}

      <MoveFolderModal
        open={moveModalFor !== null}
        meetingId={moveModalFor}
        meetingTitle={moveModalMeeting?.title ?? ""}
        onClose={() => setMoveModalFor(null)}
        onMove={handleMoveFromModal}
      />

      <MeetingExportModal
        meeting={exportTarget}
        onClose={() => setExportTarget(null)}
      />

      <ConfirmDialog
        open={deleteFolderTarget !== null}
        title={
          deleteFolderTarget
            ? `폴더 '${deleteFolderTarget.folder}' 를 삭제할까요?`
            : ""
        }
        message={
          deleteFolderTarget ? (
            <div className="space-y-2">
              <p>폴더는 영구 삭제됩니다 (복원 불가).</p>
              {deleteFolderTarget.total > 0 ? (
                <p>
                  안에 있는 메모 {deleteFolderTarget.total}개는 휴지통으로
                  이동합니다 (복원 시 폴더 밖으로 이동).
                </p>
              ) : null}
              {deleteFolderTarget.pinned > 0 ? (
                <p
                  className="font-medium"
                  style={{ color: "var(--down-ink)" }}
                >
                  이 폴더에 고정한 메모 {deleteFolderTarget.pinned}개가 있어요.
                </p>
              ) : null}
            </div>
          ) : undefined
        }
        confirmLabel="삭제"
        danger
        busy={deleteFolderMutation.isPending}
        onConfirm={() => void performDeleteFolder()}
        onCancel={() => setDeleteFolderTarget(null)}
      />

      <ConfirmDialog
        open={deleteMeetingTarget !== null}
        title={
          deleteMeetingTarget
            ? `'${deleteMeetingTarget.title}' 메모를 휴지통으로 옮길까요?`
            : ""
        }
        message="휴지통에서 다시 복원할 수 있습니다."
        confirmLabel="삭제"
        danger
        busy={deleteMeetingMutation.isPending}
        onConfirm={() => void performDeleteMeeting()}
        onCancel={() => setDeleteMeetingTarget(null)}
      />
    </div>
  );
}

// 사이드바 상단 즐겨찾기 그룹 — MeetingsTreeView 와 별도. 폴더/drag 없는 flat 리스트.
// 옵시디안 bookmarks 패턴: 같은 메모가 트리에도 보이지 않음 (mutual exclusive).
// 행 hover 시 우측에 채워진 별 아이콘 (클릭 = 고정 해제). 정렬은 사이드바 sortKey 적용.
function PinnedSection({
  meetings,
  selectedUid,
  contextMeetingId,
  onSelect,
  onContextMenu,
  onUnpin,
}: {
  meetings: Meeting[];
  selectedUid: string | null;
  // 우클릭 대상 메모 id — 컨텍스트 메뉴 열려있는 동안 시각 강조.
  contextMeetingId: string | null;
  onSelect: (uid: string) => void;
  onContextMenu: (meetingId: string, x: number, y: number) => void;
  onUnpin: (uid: string) => void;
}) {
  return (
    <div className="border-b" style={{ borderColor: "var(--line-2)" }}>
      <div
        className="px-3 pt-2 pb-1 text-3xs uppercase tracking-wider"
        style={{ color: "var(--faint)" }}
      >
        고정됨
      </div>
      <ul className="p-1 pt-0">
        {meetings.map((m) => (
          <li key={m.uid} className="list-none">
            <Button
              variant="ghost"
              onClick={() => onSelect(m.uid)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(m.id, e.clientX, e.clientY);
              }}
              className="group w-full justify-start gap-1.5 rounded py-1 pr-2 text-sm font-normal"
              style={{
                paddingLeft: "8px",
                backgroundColor:
                  m.uid === selectedUid ? "var(--surface-3)" : undefined,
                color: "var(--ink)",
                boxShadow:
                  m.id === contextMeetingId
                    ? "inset 0 0 0 1.5px var(--focus-ring)"
                    : undefined,
              }}
            >
              <Star
                className="h-3 w-3 shrink-0"
                fill="var(--accent-yellow)"
                style={{ color: "var(--accent-yellow)" }}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {m.title?.trim() || "(제목 없음)"}
              </span>
              {/* hover 시 우측에 unpin 버튼 (X 처럼 — 별 위에 사선 대신 단순 X 가
                  명확). nested button 회피 위해 span + onMouseDown 처리. */}
              <span
                role="button"
                aria-label="고정 해제"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onUnpin(m.uid);
                }}
                className="hidden h-4 w-4 shrink-0 items-center justify-center rounded group-hover:inline-flex"
                style={{ color: "var(--faint)" }}
              >
                <X className="h-3 w-3" />
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 폴더 우클릭/… 버튼 컨텍스트 메뉴 — 이름 변경 + 삭제. 상단 폴더명 헤더는 제거
// (우클릭/… 으로 이미 대상이 강조되어 redundant).
function FolderContextMenu({
  x,
  y,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
}) {
  const MENU_W = 200;
  const MENU_H = 76;
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.min(y, window.innerHeight - MENU_H - 8);
  return (
    <div
      className="fixed z-50 overflow-hidden rounded-md shadow-lg"
      style={{
        left,
        top,
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
        minWidth: MENU_W,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        onClick={onRename}
        className="w-full justify-start gap-2 rounded-none px-3 py-2"
        leftIcon={
          <Pencil
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--faint)" }}
          />
        }
        style={{ color: "var(--ink)" }}
      >
        이름 변경...
      </Button>
      <Button
        variant="ghost"
        onClick={onDelete}
        className="w-full justify-start gap-2 rounded-none px-3 py-2"
        leftIcon={<Trash2 className="h-3.5 w-3.5 shrink-0" />}
        style={{ color: "var(--down)" }}
      >
        폴더 삭제...
      </Button>
    </div>
  );
}

// 메모 우클릭 컨텍스트 메뉴 — 타이틀바 … 메뉴와 동일 항목 (MeetingMenuItems 공유).
// 고정 / 폴더로 이동 / 마크다운 복사 / 내보내기 / 삭제.
function MeetingContextMenu({
  x,
  y,
  pinned,
  deleteDisabled,
  onTogglePin,
  onMove,
  onCopy,
  onExport,
  onDelete,
}: {
  x: number;
  y: number;
  pinned: boolean;
  deleteDisabled?: boolean;
  onTogglePin: () => void;
  onMove: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  // 우측/하단 viewport 초과 방지 — 좌표 clamp (메뉴 크기 추정). 항목 7개(구분선 2 포함).
  const MENU_W = 184;
  const MENU_H = 232;
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.min(y, window.innerHeight - MENU_H - 8);
  return (
    <div
      className="fixed z-50 overflow-hidden rounded-md py-1 shadow-lg"
      style={{
        left,
        top,
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
        minWidth: MENU_W,
      }}
      // mousedown 으로 메뉴 자체 클릭이 outside-close trigger 되지 않도록 막음
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MeetingMenuItems
        pinned={pinned}
        onTogglePin={onTogglePin}
        onMove={onMove}
        onCopy={onCopy}
        onExport={onExport}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled}
      />
    </div>
  );
}

// AppShell.sidePanelFooter slot 으로 주입. 메모장 탭의 list 모드일 때만 보임.
export function MeetingsSidePanelFooter({
  onTrashOpen,
  markdownHelpOpen,
  onMarkdownHelpToggle,
}: {
  onTrashOpen: () => void;
  markdownHelpOpen?: boolean;
  onMarkdownHelpToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="icon"
        onClick={onMarkdownHelpToggle}
        title={markdownHelpOpen ? "도움말 닫기" : "마크다운 도움말"}
        aria-label={markdownHelpOpen ? "도움말 닫기" : "마크다운 도움말"}
        style={{
          color: markdownHelpOpen ? "var(--ink)" : "var(--faint)",
          backgroundColor: markdownHelpOpen ? "var(--surface-3)" : undefined,
        }}
      >
        {markdownHelpOpen ? (
          <X className="h-3.5 w-3.5" />
        ) : (
          <HelpCircle className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="icon"
        onClick={onTrashOpen}
        title="휴지통"
        aria-label="휴지통"
        style={{ color: "var(--faint)" }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// portfolio 탭에서만 보임. 메모장과 별개 도메인 휴지통 (portfolio/.trash/).
// 가이드북 진입도 같이 — 사이드바 헤더 자리 비우고 footer 로 모은다.
export function PortfolioSidePanelFooter({
  onTrashOpen,
  onGuideOpen,
}: {
  onTrashOpen: () => void;
  onGuideOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="icon"
        onClick={onTrashOpen}
        title="포트폴리오 휴지통"
        aria-label="포트폴리오 휴지통"
        style={{ color: "var(--faint)" }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="icon"
        onClick={onGuideOpen}
        title="가이드북"
        aria-label="가이드북"
        style={{ color: "var(--faint)" }}
      >
        <BookOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// 마크다운 문법 패널 — open 상태는 App 이 소유 (footer 버튼이 토글). 콘텐츠 영역
// (MeetingsSidePanel root, relative) 안에서 absolute inset-0 으로 렌더 → 하단
// footer 는 안 덮음. 닫기는 footer 의 토글 버튼 (좌측하단) + ESC.
function MarkdownHelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex shrink-0 items-center px-4"
        style={{ height: "var(--page-header-h)", borderBottom: "1px solid var(--line)" }}
      >
        <Text variant="body" weight="semibold" as="span">
          마크다운 문법
        </Text>
      </div>
      {/* 정렬 2열 grid: 칩(auto)·설명(1fr) 한 column 으로 가지런히. 섹션 라벨은 full-span row. */}
      <div
        className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 px-4 py-4 text-sm"
        style={{ color: "var(--ink)" }}
      >
        {MARKDOWN_HINTS.map((h, i) => (
          <Fragment key={i}>
            {h.section ? (
              <div
                className="col-span-2 mb-0.5 mt-3 text-3xs font-semibold uppercase tracking-wider first:mt-0"
                style={{ color: "var(--faint)" }}
              >
                {h.section}
              </div>
            ) : null}
            <code
              className="whitespace-nowrap rounded px-1.5 py-0.5 text-left font-mono text-2xs"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--sub)" }}
            >
              {h.syntax}
            </code>
            <Text variant="caption" color="muted" as="span">{h.desc}</Text>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const SORT_OPTIONS: Array<{ id: MeetingSortKey; label: string }> = [
  { id: "date_desc", label: "최신순" },
  { id: "date_asc", label: "오래된순" },
  { id: "name", label: "이름순" },
];

function SortMenu({
  value,
  onChange,
}: {
  value: MeetingSortKey;
  onChange: (next: MeetingSortKey) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="relative"
      panelClassName="absolute right-0 top-full z-30 mt-1 min-w-[120px] overflow-hidden rounded-md shadow-md"
      panelStyle={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
      trigger={
        <Button
          variant="icon"
          onClick={() => setOpen((v) => !v)}
          title="정렬"
          aria-label="정렬"
          aria-haspopup="menu"
          aria-expanded={open}
          style={{
            color: "var(--sub)",
            backgroundColor: open ? "var(--surface-3)" : undefined,
          }}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div role="menu">
        {SORT_OPTIONS.map((opt) => {
          const active = opt.id === value;
          return (
            <Button
              key={opt.id}
              variant="ghost"
              size="sm"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className="w-full justify-between rounded-none px-3 py-1.5"
              style={{
                color: active ? "var(--ink)" : "var(--sub)",
                backgroundColor: active ? "var(--surface-3)" : undefined,
              }}
            >
              <span>{opt.label}</span>
              {active ? (
                <Check className="h-3 w-3" style={{ color: "var(--sub)" }} />
              ) : null}
            </Button>
          );
        })}
      </div>
    </Popover>
  );
}

// 좁은 사이드바(288px)용으로 압축 — 비슷한 건 한 줄로 묶되, 칩은 항목당 하나(2개씩
// 묶지 않음). 자주 쓰는 문법 위주, 드문 reference 문법(참조 링크·4칸 코드블록 등)은 생략.
const MARKDOWN_HINTS: Array<{ syntax: string; desc: string; section?: string }> = [
  { section: "제목", syntax: "# ~ ######", desc: "제목 H1 ~ H6" },
  { syntax: "=== / ---", desc: "윗줄을 H1 / H2 로" },

  { section: "서식 (인라인)", syntax: "**굵게**", desc: "굵은 글씨" },
  { syntax: "*기울임*", desc: "기울인 글씨" },
  { syntax: "~~취소선~~", desc: "취소선" },
  { syntax: "`코드`", desc: "인라인 코드" },

  { section: "목록", syntax: "- 항목", desc: "글머리 목록" },
  { syntax: "1. 항목", desc: "번호 목록" },
  { syntax: "- [ ] 할 일", desc: "체크박스" },
  { syntax: "␣␣- 항목", desc: "중첩 목록" },

  { section: "블록", syntax: "> 인용문", desc: "인용 블록" },
  { syntax: "```코드```", desc: "코드 블록 (펜스)" },
  { syntax: "---", desc: "구분선 (앞뒤 빈 줄)" },

  { section: "줄바꿈", syntax: "Enter", desc: "줄바꿈 (2번=문단)" },

  { section: "링크 / 이미지", syntax: "[텍스트](URL)", desc: "링크" },
  { syntax: "![설명](URL)", desc: "이미지" },

  { section: "표", syntax: "| A | B |", desc: "표 (GFM)" },
  { syntax: "|---|---|", desc: "헤더 구분선" },
];

// 섹션 children wrapper — 메모장 폴더 트리의 indent + vertical guide 패턴 차용.
// 헤더 chevron(8px paddingLeft + 6px half)=14px 위치에 세로 guide line, 안의 항목들은
// paddingLeft 16px 만큼 들여쓰기 → "폴더 안에 들어있다" 시각 신호.
function SectionChildren({ children }: { children: ReactNode }) {
  return (
    <div className="relative pr-1 pb-2" style={{ paddingLeft: "16px" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 w-px"
        style={{ left: "14px", backgroundColor: "var(--line)" }}
      />
      {children}
    </div>
  );
}

// 캘린더 day panel 의 섹션 헤더 — 메모장 폴더 패턴 (chevron + 13px secondary 라벨) 차용.
// 클릭 시 collapse. count 가 있으면 라벨 옆에 mono 숫자.
function SidePanelSectionHeader({
  label,
  collapsed,
  onToggle,
  count,
  action,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  count?: number;
  // 헤더 우측 액션 (예: 프로젝트 추가 +). 토글 button 과 형제로 둠 (nested button 회피).
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        onClick={onToggle}
        className="flex-1 justify-between gap-1.5 rounded-none py-1 pr-2 text-sm font-normal"
        style={{ paddingLeft: "8px", color: "var(--sub)" }}
      >
        <span className="inline-flex items-center gap-1.5">
          {collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          <span>{label}</span>
        </span>
        {typeof count === "number" ? (
          <span
            className="text-2xs tabular-nums"
            style={{ color: "var(--faint)" }}
          >
            {count}
          </span>
        ) : null}
      </Button>
      {action ? <span className="shrink-0 pr-1">{action}</span> : null}
    </div>
  );
}

/* ── Todos Side Panel — 상태 필터 + 프로젝트(파일) 리스팅 ── */

export type TaskStatusFilter = "all" | "pending" | "done" | "cancelled";

type TodosPanelProps = {
  statusFilter: TaskStatusFilter;
  onStatusChange: (next: TaskStatusFilter) => void;
  // 선택된 프로젝트 파일(`tasks/{이름}.md`). null = 전체(모든 프로젝트).
  selectedProject: string | null;
  onSelectProject: (file: string | null) => void;
};

export function TodosSidePanel({
  statusFilter,
  onStatusChange,
  selectedProject,
  onSelectProject,
}: TodosPanelProps) {
  const { data } = useTasks();
  const tasks = data ?? [];
  const projectsQ = useTaskProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const [collapsedProjects, setCollapsedProjects] = useState(false);
  // 프로젝트 추가 인라인 입력 + 삭제 확인.
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<TaskProject | null>(null);

  // 프로젝트(파일)별 활성 task 카운트 — 삭제/취소 제외.
  const projectCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.deleted || t.cancelled) continue;
      map.set(t._source.file, (map.get(t._source.file) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) {
      setAddingProject(false);
      return;
    }
    createProject.mutate(name, {
      onSuccess: (p) => onSelectProject(p.file),
    });
    setNewProjectName("");
    setAddingProject(false);
  }

  // status 별 count. deleted 는 휴지통 modal 전용으로 격리.
  const counts = useMemo(() => {
    const status: Record<TaskStatusFilter, number> = {
      all: 0,
      pending: 0,
      done: 0,
      cancelled: 0,
    };
    for (const t of tasks) {
      if (t.deleted) continue;
      if (t.cancelled) {
        status.cancelled++;
        continue;
      }
      status.all++;
      if (t.done) status.done++;
      else status.pending++;
    }
    return { status };
  }, [tasks]);

  // status row — 라벨 + 카운트만, leading 아이콘 없음. status 가 단일 차원이라
  // 라벨 텍스트만으로 충분히 명확. 캘린더/포트폴리오 패턴과 align.
  const statusItems: Array<{
    id: TaskStatusFilter;
    label: string;
    count: number;
  }> = [
    { id: "all", label: "전체", count: counts.status.all },
    { id: "pending", label: "미완료", count: counts.status.pending },
    { id: "done", label: "완료", count: counts.status.done },
  ];

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-4"
        style={{
          height: "var(--page-header-h)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2
          className="font-serif text-sm font-medium"
          style={{ color: "var(--ink)" }}
        >
          할 일
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="icon"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("todos:add-request", {
                  detail: {
                    type: "task",
                    // 특정 프로젝트 선택 중이면 그 파일에 바로 추가.
                    prefill: selectedProject
                      ? { target_file: selectedProject }
                      : undefined,
                  },
                }),
              )
            }
            title="새 할 일"
            style={{ color: "var(--sub)" }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col"
        aria-label="필터"
      >
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {/* status 필터 — 사이드바 최상단 flat. 폴더 outer 없이 메모장 트리의 nav p-1 패턴. */}
          <div className="p-1">
            {statusItems.map((item) => (
              <FilterItem
                key={item.id}
                label={item.label}
                count={item.count}
                active={item.id === statusFilter}
                onClick={() => onStatusChange(item.id)}
              />
            ))}
          </div>

          {/* 프로젝트 — `tasks/` 폴더 리스팅. "전체" + 파일별 항목. + 로 새 파일 추가. */}
          <SidePanelSectionHeader
            label="프로젝트"
            collapsed={collapsedProjects}
            onToggle={() => setCollapsedProjects((v) => !v)}
            action={
              <Button
                variant="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsedProjects(false);
                  setAddingProject(true);
                }}
                title="새 프로젝트"
                aria-label="새 프로젝트"
                style={{ color: "var(--sub)" }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            }
          />
          {!collapsedProjects ? (
            <SectionChildren>
              <FilterItem
                label="전체"
                active={selectedProject === null}
                onClick={() => onSelectProject(null)}
              />
              {(projectsQ.data ?? []).map((p) => (
                <ProjectItem
                  key={p.file}
                  project={p}
                  count={projectCounts.get(p.file) ?? 0}
                  active={selectedProject === p.file}
                  onSelect={() => onSelectProject(p.file)}
                  onDelete={
                    p.isInbox ? undefined : () => setProjectToDelete(p)
                  }
                />
              ))}
              {addingProject ? (
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onBlur={handleCreateProject}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateProject();
                    } else if (e.key === "Escape") {
                      setNewProjectName("");
                      setAddingProject(false);
                    }
                  }}
                  placeholder="프로젝트 이름"
                  className="mx-2 my-1 w-[calc(100%-1rem)] rounded-md px-2 py-1 text-sm outline-none"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                />
              ) : null}
            </SectionChildren>
          ) : null}
        </div>
        {/* 취소됨 — 사이드바 하단 별도 entry. 폴더 밖이라 들여쓰기 없이 outer level
            (헤더 chevron 위치 8px 와 align). 좌우 padding 1 = 메모장 트리 root 와 동일. */}
        <div
          className="px-1 py-2"
          style={{ borderTop: "1px solid var(--line)" }}
        >
          <FilterItem
            label="취소됨"
            count={counts.status.cancelled}
            leading={
              <XCircle
                className="h-3 w-3"
                strokeWidth={1.75}
                style={{ color: "var(--sub)" }}
              />
            }
            active={statusFilter === "cancelled"}
            onClick={() => onStatusChange("cancelled")}
          />
        </div>
      </nav>
      {projectToDelete ? (
        <ConfirmDialog
          open
          title="프로젝트 삭제"
          message={`"${projectToDelete.name}" 프로젝트 파일을 휴지통으로 보냅니다. 안의 할 일도 함께 사라집니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => {
            const target = projectToDelete;
            deleteProject.mutate(target, {
              onSuccess: () => {
                if (selectedProject === target.file) onSelectProject(null);
              },
            });
            setProjectToDelete(null);
          }}
          onCancel={() => setProjectToDelete(null)}
        />
      ) : null}
    </div>
  );
}

// 프로젝트(파일) 사이드바 row — FilterItem 룩 + hover 시 삭제 버튼. inbox 는 삭제 불가.
function ProjectItem({
  project,
  count,
  active,
  onSelect,
  onDelete,
}: {
  project: TaskProject;
  count: number;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="group flex items-center rounded-md transition hover:bg-[var(--surface-2)]"
      style={{ backgroundColor: active ? "var(--surface-3)" : undefined }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm"
        style={{ color: "var(--ink)" }}
      >
        <Folder className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {count > 0 ? (
          <span
            className="shrink-0 text-2xs tabular-nums"
            style={{ color: "var(--faint)" }}
          >
            {count}
          </span>
        ) : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="프로젝트 삭제"
          aria-label={`${project.name} 삭제`}
          className="shrink-0 px-1.5 opacity-0 transition group-hover:opacity-100"
          style={{ color: "var(--faint)" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

// 루틴 사이드바 row — 오늘 체크박스 + 시간 + 이름. row click = RoutineDetail 진입.
// 루틴 사이드바 row — 캘린더 사이드바의 task row 패턴 차용 (div role=button + flex
// items-start + CheckboxButton). 디자인 시스템의 체크박스/Text 컴포넌트만 사용.
function RoutineSidebarItem({
  routine,
  today,
  active,
  onSelect,
  onToggleToday,
}: {
  routine: Routine;
  today: string;
  active: boolean;
  onSelect: () => void;
  onToggleToday: () => void;
}) {
  const done = routine.log.has(today);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-[var(--surface-2)]"
      style={{
        backgroundColor: active ? "var(--surface-3)" : undefined,
      }}
    >
      <CheckboxButton
        status={done ? "done" : "pending"}
        shape="circle"
        onClick={onToggleToday}
      />
      <span
        className={`min-w-0 flex-1 truncate ${done ? "line-through" : ""}`}
        style={{
          color: done ? "var(--faint)" : "var(--ink)",
        }}
      >
        {routine.name}
      </span>
      {routine.frontmatter.time ? (
        <span
          className="shrink-0 text-2xs tabular-nums"
          style={{ color: "var(--faint)" }}
        >
          {routine.frontmatter.time}
        </span>
      ) : null}
    </div>
  );
}

// 지난 루틴 사이드바 row — 종료일 chip 만 표시 (체크박스 없음, 시간 정보 무의미).
// 클릭 시 RoutineDetail 진입 — 사용자는 종료일을 미래로 미루면 다시 활성으로 돌아옴.
function ArchivedRoutineSidebarItem({
  routine,
  active,
  onSelect,
}: {
  routine: Routine;
  active: boolean;
  onSelect: () => void;
}) {
  const ends = routine.frontmatter.ends ?? "";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-[var(--surface-2)]"
      style={{
        backgroundColor: active ? "var(--surface-3)" : undefined,
      }}
    >
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: "var(--sub)" }}
      >
        {routine.name}
      </span>
      {ends ? (
        <span
          className="shrink-0 text-2xs tabular-nums"
          style={{ color: "var(--faint)" }}
          title={`종료일 ${ends}`}
        >
          ~{ends.slice(5)}
        </span>
      ) : null}
    </div>
  );
}

// AppShell.sidePanelFooter slot 으로 주입. 할 일 탭의 휴지통 entry —
// 메모/포트폴리오와 동일 패턴 (탭별 1 trash). 모달은 태스크/루틴 chip 으로 구분한 단일 리스트.
export function TodosSidePanelFooter({
  onTrashOpen,
}: {
  onTrashOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="icon"
        onClick={onTrashOpen}
        title="휴지통"
        aria-label="휴지통"
        style={{ color: "var(--faint)" }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ── Routines Side Panel — 루틴 탭. 활성 + 지난 루틴 목록 (오늘 체크 + 상세 진입). ── */

type RoutinesPanelProps = {
  selectedRoutineName: string | null;
  onSelectRoutine: (name: string | null) => void;
};

export function RoutinesSidePanel({
  selectedRoutineName,
  onSelectRoutine,
}: RoutinesPanelProps) {
  const today = todayIso();
  const activeRoutines = useActiveRoutines(today);
  const archivedRoutines = useArchivedRoutines(today);
  const toggleRoutineDayMutation = useToggleRoutineDay();
  const [collapsedArchive, setCollapsedArchive] = useState(true);

  function handleToggleRoutineToday(name: string) {
    const r = activeRoutines.find((x) => x.name === name);
    if (!r) return;
    toggleRoutineDayMutation.mutate({ name, date: today, done: !r.log.has(today) });
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-4"
        style={{
          height: "var(--page-header-h)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2
          className="font-serif text-sm font-medium"
          style={{ color: "var(--ink)" }}
        >
          루틴
        </h2>
        <Button
          variant="icon"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("todos:add-request", { detail: { type: "routine" } }),
            )
          }
          title="새 루틴"
          aria-label="새 루틴"
          style={{ color: "var(--sub)" }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col" aria-label="루틴">
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <div className="p-1">
            {activeRoutines.length === 0 ? (
              <Text
                variant="caption"
                color="muted"
                as="div"
                className="px-2 py-1 text-sm"
              >
                아직 루틴이 없어요
              </Text>
            ) : (
              activeRoutines.map((r) => (
                <RoutineSidebarItem
                  key={r.name}
                  routine={r}
                  today={today}
                  active={r.name === selectedRoutineName}
                  onSelect={() => onSelectRoutine(r.name)}
                  onToggleToday={() => handleToggleRoutineToday(r.name)}
                />
              ))
            )}
          </div>

          {archivedRoutines.length > 0 ? (
            <>
              <SidePanelSectionHeader
                label="지난 루틴"
                collapsed={collapsedArchive}
                onToggle={() => setCollapsedArchive((v) => !v)}
                count={archivedRoutines.length}
              />
              {!collapsedArchive ? (
                <SectionChildren>
                  {archivedRoutines.map((r) => (
                    <ArchivedRoutineSidebarItem
                      key={r.name}
                      routine={r}
                      active={r.name === selectedRoutineName}
                      onSelect={() => onSelectRoutine(r.name)}
                    />
                  ))}
                </SectionChildren>
              ) : null}
            </>
          ) : null}
        </div>
      </nav>
    </div>
  );
}

export function RoutinesSidePanelFooter({
  onTrashOpen,
}: {
  onTrashOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="icon"
        onClick={onTrashOpen}
        title="휴지통"
        aria-label="휴지통"
        style={{ color: "var(--faint)" }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
