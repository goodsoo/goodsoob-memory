import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { Meeting } from "../../api/meetings";
import {
  buildMeetingsTree,
  canDropFolder,
  type MeetingComparator,
  type MeetingsFolderNode,
} from "../../lib/meetingsTree";
import { useScopedKey } from "../../lib/vault/scopedStorage";
import { formatDisplayDate } from "../../lib/dates";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

const FOLDER_EXPAND_BASE_KEY = "goodsoob:meetingFolderExpand";
// 트리 collapsed 상태를 localStorage 에 저장. "expanded" set 보다 "collapsed" set 으로
// 보관 — 새 폴더는 default expanded (사용자가 명시적으로 collapse 한 폴더만 기억).
// vault 별로 폴더 위계가 다르므로 useScopedKey 로 vault id namespace.
function loadCollapsed(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === "string"));
  } catch {
    return new Set();
  }
}

function saveCollapsed(key: string, set: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore — localStorage 막혀있어도 in-memory state 는 그대로 동작
  }
}

export type EditingFolderState = {
  folder: string; // meetings-relative path (e.g. "work" or "work/2026")
  value: string; // 현재 input value
};

// DnD custom MIME — OS 드래그와 충돌 안 나게 고유 type. 메모는 uid, 폴더는 path.
const MEETING_UID_MIME = "text/x-goodsoob-meeting-uid";
const FOLDER_PATH_MIME = "text/x-goodsoob-folder-path";

// 끌고 있는 대상. 메모(uid) 와 폴더(path) 를 한 시스템으로 다룬다. drop 시점의
// 진짜 payload 는 dataTransfer 에서 읽고, 이 state 는 시각 강조(드래그 dim / drop
// 가능 여부) 전용 — React 가 reconciliation 으로 갱신해도 native drag 에 영향 X.
type DragItem =
  | { kind: "meeting"; uid: string }
  | { kind: "folder"; path: string };

// 행 시각 단위.
const INDENT_UNIT = 16;
const ROW_BASE_PAD_LEFT = 8; // ul 의 좌 패딩과 동일 — chevron 시작 위치
// chevron(12px) + gap(6px). 메모 행은 chevron 자리가 없어서 paddingLeft 에 더해
// 같은 column 위치로 align (옵시디안 패턴).
const TITLE_OFFSET = 12 + 6;

type Props = {
  meetings: Meeting[];
  // 빈 폴더 포함 disk 의 모든 폴더 path (vault root 기준 또는 meetings-relative 모두 OK).
  // 메모 0개라도 옵시디안에서 mkdir 한 폴더 + 사이드바 "+폴더" 로 만든 폴더 보여줌.
  extraFolders?: string[];
  selectedUid: string | null;
  // 우클릭/… 으로 컨텍스트 메뉴가 열린 대상 — 그 동안 시각 강조. null = 없음.
  contextMeetingId?: string | null;
  contextFolder?: string | null;
  onSelect: (uid: string) => void;
  // 같은 폴더 안에서만 적용되는 정렬. 폴더 위계는 alphabetic 고정.
  sortMeetings?: MeetingComparator;
  // 인라인 rename — 옵시디안 패턴. 해당 폴더 행의 이름 자리에 input 렌더.
  editingFolder?: EditingFolderState | null;
  editingFolderPending?: boolean;
  onEditingFolderChange?: (value: string) => void;
  onEditingFolderCommit?: () => void;
  onEditingFolderCancel?: () => void;
  // 컨텍스트 메뉴 (메모 우클릭) — 메모 ID 와 위치 전달.
  onContextMenu: (meetingId: string, x: number, y: number) => void;
  // 폴더 우클릭. folder = meetings-relative path (e.g. "work" or "work/2026").
  onFolderContextMenu: (folder: string, x: number, y: number) => void;
  // DnD 메모 이동 — 메모를 폴더에 drop 시 호출. folder 빈 문자열 = root.
  onMoveDrop: (uid: string, folder: string) => void;
  // DnD 폴더 이동 — 폴더를 다른 폴더(또는 root)에 drop 시 호출. destParent "" = root.
  onFolderMoveDrop: (srcFolder: string, destParent: string) => void;
  // 새 메모/폴더 생성 직후 그 폴더 자동 펼침 트리거. revealNonce 가 바뀔 때
  // revealPath(+모든 조상)를 collapsed set 에서 제거. 생성 외 일반 선택엔 안 씀
  // (사용자가 명시적으로 접은 폴더는 그대로 둔다 — collapse 가 안 되살아남).
  revealPath?: string;
  revealNonce?: number;
};

export function MeetingsTreeView({
  meetings,
  extraFolders,
  selectedUid,
  contextMeetingId,
  contextFolder,
  onSelect,
  sortMeetings,
  editingFolder,
  editingFolderPending,
  onEditingFolderChange,
  onEditingFolderCommit,
  onEditingFolderCancel,
  onContextMenu,
  onFolderContextMenu,
  onMoveDrop,
  onFolderMoveDrop,
  revealPath,
  revealNonce,
}: Props) {
  const folderExpandKey = useScopedKey(FOLDER_EXPAND_BASE_KEY);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(folderExpandKey));
  const [dropTarget, setDropTarget] = useState<string | null>(null); // 강조 중인 폴더 path
  const [dragItem, setDragItem] = useState<DragItem | null>(null);

  // vault 전환 시 새 vault 의 collapsed set 으로 갈아끼움.
  useEffect(() => {
    setCollapsed(loadCollapsed(folderExpandKey));
  }, [folderExpandKey]);

  useEffect(() => {
    saveCollapsed(folderExpandKey, collapsed);
  }, [folderExpandKey, collapsed]);

  // 새 메모/폴더 생성 시 그 폴더(+조상)를 collapsed 에서 제거 → 자동 펼침.
  // revealNonce 변화에만 반응 (사용자가 직접 접은 폴더는 안 되살림). React 공식
  // "prop 변화 시 state 조정" 패턴 — 렌더 중 setState (effect 아님 → cascade 없음).
  const [seenRevealNonce, setSeenRevealNonce] = useState(revealNonce);
  if (revealNonce !== seenRevealNonce) {
    setSeenRevealNonce(revealNonce);
    if (revealPath) {
      setCollapsed((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        let acc = "";
        for (const seg of revealPath.split("/")) {
          acc = acc ? `${acc}/${seg}` : seg;
          next.delete(acc);
        }
        return next.size === prev.size ? prev : next;
      });
    }
  }

  const tree = useMemo(
    () => buildMeetingsTree(meetings, sortMeetings, extraFolders ?? []),
    [meetings, sortMeetings, extraFolders],
  );

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // 메모/폴더 드래그 공통: native drag init 이후 setState (아래 race 주석 참조).
  // dragstart handler 안에서 동기 setState 호출하면 React reconciliation 이
  // RootDropZone outline 을 mount → DOM mutation → WKWebView 가 drag source
  // 변경 감지하고 native drag operation 즉시 cancel (start 직후 9ms 안에 end
  // 발사되던 패턴). setTimeout(0) 으로 native drag init commit 이후 setState.
  function handleDragStart(e: React.DragEvent, uid: string) {
    e.dataTransfer.setData(MEETING_UID_MIME, uid);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => setDragItem({ kind: "meeting", uid }), 0);
  }

  function handleDragStartFolder(e: React.DragEvent, path: string) {
    e.dataTransfer.setData(FOLDER_PATH_MIME, path);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => setDragItem({ kind: "folder", path }), 0);
  }

  function handleDragEnd() {
    setDragItem(null);
    setDropTarget(null);
  }

  // dragOver 단계에서 preventDefault 를 무조건 호출해야 drop 이 fire 됨.
  // dataTransfer.types 검사로 분기하면 Tauri WebView 등에서 dragover 단계에 types
  // 가 비어있어 preventDefault 가 skip → drop 자체가 안 발사되는 버그. drop 단계에서
  // 실제 payload 로 분기. drop 가능 여부는 React state(dragItem) 로 판정 — Tauri
  // 에서도 신뢰 가능 (dataTransfer.types 와 달리 항상 채워져 있음).
  function handleDragOverFolder(e: React.DragEvent, folder: string) {
    e.preventDefault();
    const allowed =
      dragItem?.kind === "folder"
        ? canDropFolder(dragItem.path, folder)
        : true;
    e.dataTransfer.dropEffect = allowed ? "move" : "none";
    if (dropTarget !== folder) setDropTarget(folder);
  }

  function handleDragLeaveFolder(folder: string) {
    if (dropTarget === folder) setDropTarget(null);
  }

  function handleDropFolder(e: React.DragEvent, folder: string) {
    e.preventDefault();
    const folderPath = e.dataTransfer.getData(FOLDER_PATH_MIME);
    const uid = e.dataTransfer.getData(MEETING_UID_MIME);
    setDropTarget(null);
    setDragItem(null);
    if (folderPath) {
      // 자기 자신·자손·현재 부모(no-op) drop 은 무시 (가드는 backend 에도 있음).
      if (canDropFolder(folderPath, folder)) onFolderMoveDrop(folderPath, folder);
      return;
    }
    if (uid) onMoveDrop(uid, folder);
  }

  const isEmpty =
    tree.rootMeetings.length === 0 && tree.folders.length === 0;
  if (isEmpty) return null;

  // 항상 폴더 먼저, 메모 다음. root 메모를 별도 "기타" 그룹으로 묶지 않고 그냥
  // 폴더 트리 아래에 inline. 정렬 옵션 (date/name) 은 같은 종류 안에서만 적용.
  return (
    <ul className="p-1">
      {tree.folders.map((node) => (
        <FolderItem
          key={node.path}
          node={node}
          depth={0}
          selectedUid={selectedUid}
          contextMeetingId={contextMeetingId ?? null}
          contextFolder={contextFolder ?? null}
          collapsed={collapsed}
          dropTarget={dropTarget}
          dragItem={dragItem}
          editingFolder={editingFolder ?? null}
          editingFolderPending={editingFolderPending ?? false}
          onEditingFolderChange={onEditingFolderChange}
          onEditingFolderCommit={onEditingFolderCommit}
          onEditingFolderCancel={onEditingFolderCancel}
          onToggle={toggleFolder}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onFolderContextMenu={onFolderContextMenu}
          onDragStart={handleDragStart}
          onDragStartFolder={handleDragStartFolder}
          onDragEnd={handleDragEnd}
          onDragOverFolder={handleDragOverFolder}
          onDragLeaveFolder={handleDragLeaveFolder}
          onDropFolder={handleDropFolder}
        />
      ))}
      {/* root 메모들 — 폴더가 하나라도 있으면 "폴더 밖" 영역을 시각적으로 구분.
          drag 중에만 점선 박스 (dropTarget="" 일 땐 강조). 폴더 0개면 wrap 없이
          ul 직속 (트리 전체가 root 라 박스가 시각 noise). */}
      {tree.folders.length > 0 ? (
        <RootDropZone
          isDragging={dragItem !== null}
          isDropTarget={dropTarget === ""}
          // 폴더 드래그면 root 로 이동 가능할 때만 valid (이미 root 면 no-op).
          // 메모 드래그는 root drop 항상 가능.
          dropAllowed={
            dragItem?.kind === "folder"
              ? canDropFolder(dragItem.path, "")
              : true
          }
          isEmpty={tree.rootMeetings.length === 0}
          onDragOverFolder={handleDragOverFolder}
          onDragLeaveFolder={handleDragLeaveFolder}
          onDropFolder={handleDropFolder}
        >
          {tree.rootMeetings.map((m) => (
            <MeetingRow
              key={m.uid}
              meeting={m}
              depth={0}
              selected={m.uid === selectedUid}
              isContextTarget={m.id === contextMeetingId}
              isDragging={dragItem?.kind === "meeting" && dragItem.uid === m.uid}
              onClick={() => onSelect(m.uid)}
              onContextMenu={onContextMenu}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ))}
        </RootDropZone>
      ) : (
        tree.rootMeetings.map((m) => (
          <MeetingRow
            key={m.uid}
            meeting={m}
            depth={0}
            selected={m.uid === selectedUid}
            isContextTarget={m.id === contextMeetingId}
            isDragging={dragItem?.kind === "meeting" && dragItem.uid === m.uid}
            onClick={() => onSelect(m.uid)}
            onContextMenu={onContextMenu}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        ))
      )}
    </ul>
  );
}

// root drop zone — 폴더 밖 메모들을 감싸는 영역. drag 중에만 점선 박스 visible.
// 폴더와 명확히 구분되는 "기타 / 미분류" 영역의 시각 표현. root 메모 0개라도
// drag 중이면 빈 박스로 drop hint.
function RootDropZone({
  isDragging,
  isDropTarget,
  dropAllowed,
  isEmpty,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder,
  children,
}: {
  isDragging: boolean;
  isDropTarget: boolean;
  dropAllowed: boolean;
  isEmpty: boolean;
  onDragOverFolder: (e: React.DragEvent, folder: string) => void;
  onDragLeaveFolder: (folder: string) => void;
  onDropFolder: (e: React.DragEvent, folder: string) => void;
  children: React.ReactNode;
}) {
  // root 메모 0개 + drag 중이 아님 → 안 그림 (빈 박스 noise).
  if (isEmpty && !isDragging) return null;
  // layout shift 방지: margin/padding 은 평상시도 drag 중도 동일. outline 만 toggle
  // (outline 은 border 와 달리 layout 영향 0). drop target backgroundColor 도 layout 무관.
  // drop 불가 폴더를 root 로 끌 때(이미 root 면) hover 해도 강조 X — outline 만 점선 유지.
  const activeAllowed = isDropTarget && dropAllowed;
  return (
    <li
      className="list-none rounded"
      style={{
        margin: "0",
        padding: "0",
        minHeight: isDragging && isEmpty ? "32px" : undefined,
        backgroundColor: activeAllowed ? "var(--surface-3)" : undefined,
        outline: isDragging
          ? activeAllowed
            ? "1px dashed var(--btn-primary)"
            : "1px dashed var(--line-2)"
          : undefined,
        outlineOffset: "0px",
        cursor: isDropTarget && !dropAllowed ? "not-allowed" : undefined,
      }}
      onDragOver={(e) => onDragOverFolder(e, "")}
      onDragLeave={() => onDragLeaveFolder("")}
      onDrop={(e) => onDropFolder(e, "")}
    >
      <ul className="list-none p-0 m-0">{children}</ul>
    </li>
  );
}

function FolderItem({
  node,
  depth,
  selectedUid,
  contextMeetingId,
  contextFolder,
  collapsed,
  dropTarget,
  dragItem,
  editingFolder,
  editingFolderPending,
  onEditingFolderChange,
  onEditingFolderCommit,
  onEditingFolderCancel,
  onToggle,
  onSelect,
  onContextMenu,
  onFolderContextMenu,
  onDragStart,
  onDragStartFolder,
  onDragEnd,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder,
}: {
  node: MeetingsFolderNode;
  depth: number;
  selectedUid: string | null;
  contextMeetingId: string | null;
  contextFolder: string | null;
  collapsed: Set<string>;
  dropTarget: string | null;
  dragItem: DragItem | null;
  editingFolder: EditingFolderState | null;
  editingFolderPending: boolean;
  onEditingFolderChange?: (value: string) => void;
  onEditingFolderCommit?: () => void;
  onEditingFolderCancel?: () => void;
  onToggle: (path: string) => void;
  onSelect: (uid: string) => void;
  onContextMenu: (meetingId: string, x: number, y: number) => void;
  onFolderContextMenu: (folder: string, x: number, y: number) => void;
  onDragStart: (e: React.DragEvent, uid: string) => void;
  onDragStartFolder: (e: React.DragEvent, path: string) => void;
  onDragEnd: () => void;
  onDragOverFolder: (e: React.DragEvent, folder: string) => void;
  onDragLeaveFolder: (folder: string) => void;
  onDropFolder: (e: React.DragEvent, folder: string) => void;
}) {
  const isEditing = editingFolder?.folder === node.path;
  const isCollapsed = collapsed.has(node.path);
  const isDropTarget = dropTarget === node.path;
  const isContextTarget = contextFolder === node.path;
  // 끌고 있는 게 이 폴더 자신이면 dim. drop 가능 여부 — 폴더 드래그면 cycle/no-op
  // 가드(canDropFolder), 메모 드래그면 항상 가능.
  const isBeingDragged =
    dragItem?.kind === "folder" && dragItem.path === node.path;
  const dropAllowed =
    dragItem?.kind === "folder"
      ? canDropFolder(dragItem.path, node.path)
      : true;
  const activeAllowed = isDropTarget && dropAllowed;
  const activeBlocked = isDropTarget && !dropAllowed;
  // depth 별 indent 는 children wrapper 의 paddingLeft 가 nesting 으로 누적시킴.
  // button 자체는 항상 ROW_BASE_PAD_LEFT — 클릭존이 indent 공간까지 안 먹게.

  return (
    <li className="list-none">
      {isEditing ? (
        <FolderRowEditing
          isCollapsed={isCollapsed}
          value={editingFolder!.value}
          pending={editingFolderPending}
          onChange={onEditingFolderChange}
          onCommit={onEditingFolderCommit}
          onCancel={onEditingFolderCancel}
        />
      ) : (
        <Button
          variant="ghost"
          draggable
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            onFolderContextMenu(node.path, e.clientX, e.clientY);
          }}
          onDragStart={(e) => onDragStartFolder(e, node.path)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOverFolder(e, node.path)}
          onDragLeave={() => onDragLeaveFolder(node.path)}
          onDrop={(e) => onDropFolder(e, node.path)}
          className="group w-full justify-start gap-1.5 rounded py-1 pr-2 text-[13px] font-normal"
          style={
            {
              paddingLeft: `${ROW_BASE_PAD_LEFT}px`,
              color: "var(--sub)",
              opacity: isBeingDragged ? 0.5 : 1,
              backgroundColor: activeAllowed
                ? "var(--surface-3)"
                : undefined,
              // valid = primary 점선, blocked(자기·자손·현재 부모) = red 점선 + not-allowed.
              outline: activeAllowed
                ? "1px dashed var(--btn-primary)"
                : activeBlocked
                  ? "1px dashed var(--down-ink)"
                  : undefined,
              outlineOffset: "-2px",
              cursor: activeBlocked ? "not-allowed" : undefined,
              boxShadow: isContextTarget
                ? "inset 0 0 0 1.5px var(--focus-ring)"
                : undefined,
              WebkitUserDrag: "element",
              userSelect: "none",
            } as React.CSSProperties
          }
        >
          {isCollapsed ? (
            <ChevronRight
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--sub)" }}
            />
          ) : (
            <ChevronDown
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--sub)" }}
            />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {/* hover (또는 컨텍스트 메뉴 열림) 시 우측 … 버튼 — 우클릭과 동일 메뉴를
              버튼 아래로 연다. nested button 회피 위해 span + onMouseDown (행 toggle
              과 분리). */}
          <span
            role="button"
            aria-label="폴더 메뉴"
            title="폴더 메뉴"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onFolderContextMenu(node.path, r.left, r.bottom + 2);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={`h-4 w-4 shrink-0 items-center justify-center rounded group-hover:inline-flex ${
              isContextTarget ? "inline-flex" : "hidden"
            }`}
            style={{ color: "var(--faint)" }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </span>
        </Button>
      )}
      {!isCollapsed ? (
        <div
          className="relative"
          style={{
            // 자식 행들은 wrapper 의 paddingLeft 으로 indent. 자식 button 자체는
            // padding-left 0 으로 — 클릭존이 아이콘 직전부터 시작 (indent 공간은
            // wrapper 가 차지, 클릭 X). 트리 guide 라인은 wrapper 내부 absolute.
            paddingLeft: `${INDENT_UNIT}px`,
          }}
        >
          {/* vertical tree guide — 부모 폴더 행의 chevron center 위치와 정렬.
              ROW_BASE_PAD_LEFT(8) + chevron half(6) = 14. border-default 컬러로
              border-subtle 보다 진하게 — 명확히 보이도록. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px"
            style={{
              left: "14px",
              backgroundColor: "var(--line)",
            }}
          />
          {/* 정렬과 무관하게 sub-folder 가 항상 먼저, 그 다음 메모. 옵시디안과 동일.
              li 의 직속 자식은 ul/ol 로 감싸야 valid HTML (li-in-li nesting 회피). */}
          <ul className="list-none">
            {node.children.map((c) => (
              <FolderItem
                key={c.path}
                node={c}
                depth={depth + 1}
                selectedUid={selectedUid}
                contextMeetingId={contextMeetingId}
                contextFolder={contextFolder}
                collapsed={collapsed}
                dropTarget={dropTarget}
                dragItem={dragItem}
                editingFolder={editingFolder}
                editingFolderPending={editingFolderPending}
                onEditingFolderChange={onEditingFolderChange}
                onEditingFolderCommit={onEditingFolderCommit}
                onEditingFolderCancel={onEditingFolderCancel}
                onToggle={onToggle}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onFolderContextMenu={onFolderContextMenu}
                onDragStart={onDragStart}
                onDragStartFolder={onDragStartFolder}
                onDragEnd={onDragEnd}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                onDropFolder={onDropFolder}
              />
            ))}
            {node.meetings.map((m) => (
              <MeetingRow
                key={m.uid}
                meeting={m}
                depth={depth + 1}
                selected={m.uid === selectedUid}
                isContextTarget={m.id === contextMeetingId}
                isDragging={dragItem?.kind === "meeting" && dragItem.uid === m.uid}
                onClick={() => onSelect(m.uid)}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

// 폴더 행 in-place 편집. 폴더 row 의 chevron/icon 자리를 유지하면서 이름 자리만
// input 으로. mount 직후 자동 focus + select.
function FolderRowEditing({
  isCollapsed,
  value,
  pending,
  onChange,
  onCommit,
  onCancel,
}: {
  isCollapsed: boolean;
  value: string;
  pending: boolean;
  onChange?: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <div
      className="flex w-full min-w-0 items-center gap-1.5 rounded py-1 pr-2 text-[13px]"
      style={{
        paddingLeft: `${ROW_BASE_PAD_LEFT}px`,
        backgroundColor: "var(--surface-3)",
        minHeight: 0,
      }}
    >
      {isCollapsed ? (
        <ChevronRight
          className="h-3 w-3 shrink-0"
          style={{ color: "var(--sub)" }}
        />
      ) : (
        <ChevronDown
          className="h-3 w-3 shrink-0"
          style={{ color: "var(--sub)" }}
        />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit?.();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel?.();
          }
        }}
        onBlur={() => onCommit?.()}
        disabled={pending}
        className="h-5 min-w-0 flex-1 appearance-none rounded border-0 bg-transparent p-0 text-[13px] font-medium leading-5 outline-none"
        style={{
          color: "var(--ink)",
          boxShadow: "0 0 0 1px var(--line) inset",
          paddingInline: "4px",
        }}
      />
    </div>
  );
}

// inline meta — 날짜만. 시간/인원수는 카드에서 제외 (정보 밀도 trade-off).
// 날짜 포맷은 dates.ts 의 formatDisplayDate 공유 (앱 전체 날짜 표시 단일 포맷).
function formatMeetingMeta(meeting: Meeting): string {
  return formatDisplayDate(meeting.date);
}

function MeetingRow({
  meeting,
  selected,
  isContextTarget,
  isDragging,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: {
  meeting: Meeting;
  depth: number; // 호환용 — children wrapper 의 padding 이 indent 처리하므로 사용 X
  selected: boolean;
  isContextTarget: boolean;
  isDragging: boolean;
  onClick: () => void;
  onContextMenu: (meetingId: string, x: number, y: number) => void;
  onDragStart: (e: React.DragEvent, uid: string) => void;
  onDragEnd: () => void;
}) {
  // button 자체는 ROW_BASE_PAD_LEFT 만 — 클릭존은 아이콘부터 시작.
  // depth 별 indent 는 부모 폴더의 children wrapper paddingLeft 가 누적.
  const meta = formatMeetingMeta(meeting);
  return (
    <li className="list-none">
      <Button
        variant="ghost"
        draggable
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(meeting.id, e.clientX, e.clientY);
        }}
        onDragStart={(e) => onDragStart(e, meeting.uid)}
        onDragEnd={onDragEnd}
        className="w-full justify-start gap-1.5 rounded py-1 pr-2 text-[13px] font-normal"
        style={
          {
            paddingLeft: `${ROW_BASE_PAD_LEFT + TITLE_OFFSET}px`,
            backgroundColor: selected ? "var(--surface-3)" : undefined,
            color: "var(--ink)",
            opacity: isDragging ? 0.5 : 1,
            boxShadow: isContextTarget
              ? "inset 0 0 0 1.5px var(--focus-ring)"
              : undefined,
            WebkitUserDrag: "element",
            userSelect: "none",
          } as React.CSSProperties
        }
      >
        <span className="min-w-0 flex-1 truncate">
          {meeting.title?.trim() || "(제목 없음)"}
        </span>
        {meta ? (
          <Text
            variant="caption"
            color="muted"
            as="span"
            className="shrink-0 pl-2 text-[11px] tabular-nums"
          >
            {meta}
          </Text>
        ) : null}
      </Button>
    </li>
  );
}
