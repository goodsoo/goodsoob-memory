import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import type { PortfolioWorkMeta } from "../../api/portfolio";
import { useScopedKey } from "../../lib/vault/scopedStorage";
import { folderPathOfCard, isGithubCard } from "../../api/portfolio";
import {
  useCreatePortfolioFolder,
  useDeletePortfolioFolder,
  useManualFolders,
  useRenamePortfolioFolder,
} from "../../hooks/usePortfolio";
import { FilterItem } from "../common/FilterItem";
import { Text } from "../common/Text";
import { Button } from "../common/Button";

// portfolio 사이드바 두 그룹 필터.
// - github(repo): nameWithOwner. 카드 frontmatter.github_owner/github_repo 로 derive.
// - folder(path): 수동 폴더 vault path. 빈 = root 의 수동 카드들.
export type SourceFilter =
  | { kind: "all" }
  | { kind: "github"; repo: string }
  | { kind: "folder"; path: string }
  | { kind: "excluded" };

type Props = {
  works: PortfolioWorkMeta[];
  activeFilter: SourceFilter;
  onFilterChange: (next: SourceFilter) => void;
};

// 사이드바 헤더 FolderPlus 가 사용 — ref.current.createAndEdit() 호출.
export interface PortfolioSourceTreeHandle {
  createAndEdit: () => void;
}

const COLLAPSE_KEY = "goodsoob:portfolioSourceCollapse";

type CollapseState = { github: boolean; manual: boolean };

function readCollapse(key: string): CollapseState {
  if (typeof localStorage === "undefined") return { github: false, manual: false };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { github: false, manual: false };
    const parsed = JSON.parse(raw);
    return {
      github: typeof parsed?.github === "boolean" ? parsed.github : false,
      manual: typeof parsed?.manual === "boolean" ? parsed.manual : false,
    };
  } catch {
    return { github: false, manual: false };
  }
}

export const PortfolioSourceTree = forwardRef<
  PortfolioSourceTreeHandle,
  Props
>(function PortfolioSourceTree({ works, activeFilter, onFilterChange }, ref) {
  const foldersQuery = useManualFolders();
  const createFolder = useCreatePortfolioFolder();
  const renameFolder = useRenamePortfolioFolder();
  const deleteFolder = useDeletePortfolioFolder();

  const folders = foldersQuery.data ?? [];

  // 섹션 접힘 상태 — vault 별 분리 (개인/회사 vault 별 다른 default).
  const collapseKey = useScopedKey(COLLAPSE_KEY);
  const [collapse, setCollapse] = useState<CollapseState>(() =>
    readCollapse(collapseKey),
  );
  useEffect(() => {
    setCollapse(readCollapse(collapseKey));
  }, [collapseKey]);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(collapseKey, JSON.stringify(collapse));
  }, [collapseKey, collapse]);

  const [editing, setEditing] = useState<{ path: string; value: string } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // 편집 진입 시 focus + select 는 input 의 autoFocus + onFocus 에 위임.
  // (옛 useEffect 패턴은 editing 객체 dep 으로 매 글자 select 되던 race 가 있어 제거.)

  useEffect(() => {
    if (!contextMenu) return;
    // 메뉴 안 클릭은 무시 — 안 메뉴 button 의 click 이 발사되도록.
    const onPointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // GitHub 그룹: 카드 frontmatter 의 nameWithOwner 자동 집계. PR 0 인 repo 는 숨김.
  const githubRepos = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of works) {
      if (!isGithubCard(w.frontmatter)) continue;
      if (!w.frontmatter.included) continue;
      const repo = `${w.frontmatter.github_owner}/${w.frontmatter.github_repo}`;
      counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
  }, [works]);

  // 수동 폴더별 카운트 — 카드 filePath 의 folder path 와 매칭. nested 는 정확 일치만.
  // root 수동 카드는 path = "" 카운트.
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of works) {
      if (isGithubCard(w.frontmatter)) continue;
      if (!w.frontmatter.included) continue;
      const path = folderPathOfCard(w.filePath);
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return counts;
  }, [works]);

  // 총 카운트 — included 만.
  const allCount = useMemo(
    () => works.filter((w) => w.frontmatter.included).length,
    [works],
  );

  // root 수동 카드 카운트. root 는 별도 "내가 만든 폴더 - (root)" 항목.
  const rootManualCount = folderCounts.get("") ?? 0;

  const handleCreate = async () => {
    const base = "새 폴더";
    const existing = new Set(folders.map((f) => f.path));
    let candidate = base;
    let n = 2;
    while (existing.has(candidate)) {
      candidate = `${base} ${n}`;
      n++;
    }
    try {
      const path = await createFolder.mutateAsync({
        parent: "",
        name: candidate,
      });
      // 만든 폴더 가 collapse 상태에 가려지지 않게 [내가 만든 폴더] 자동 expand.
      setCollapse((c) => ({ ...c, manual: false }));
      onFilterChange({ kind: "folder", path });
      setEditing({ path, value: candidate });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useImperativeHandle(ref, () => ({
    createAndEdit: () => {
      void handleCreate();
    },
  }));

  const commitEditing = async () => {
    if (!editing) return;
    const trimmed = editing.value.trim();
    const original = folders.find((f) => f.path === editing.path);
    if (!trimmed || !original || trimmed === original.name) {
      setEditing(null);
      return;
    }
    try {
      const result = await renameFolder.mutateAsync({
        fromPath: editing.path,
        newName: trimmed,
      });
      if (
        activeFilter.kind === "folder" &&
        activeFilter.path === editing.path
      ) {
        onFilterChange({ kind: "folder", path: result.toPath });
      }
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEditing(null);
    }
  };

  const cancelEditing = () => {
    setEditing(null);
  };

  const startRename = (path: string) => {
    const f = folders.find((x) => x.path === path);
    if (!f) return;
    setEditing({ path, value: f.name });
  };

  const handleDelete = async (path: string) => {
    const f = folders.find((x) => x.path === path);
    if (!f) return;
    const n = folderCounts.get(path) ?? 0;
    const msg =
      n === 0
        ? `폴더 '${f.name}' 를 삭제할까요?`
        : `폴더 '${f.name}' 와 안에 있는 카드 ${n}개를 휴지통으로 옮길까요?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteFolder.mutateAsync(path);
      if (
        activeFilter.kind === "folder" &&
        (activeFilter.path === path ||
          activeFilter.path.startsWith(`${path}/`))
      ) {
        onFilterChange({ kind: "all" });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // top level 폴더만 — nested 는 sub-tree 로 표시 (현재 flat list, nested 트리는 후속).
  const topFolders = folders.filter((f) => !f.parent);

  return (
    <nav className="flex flex-col p-2 text-sm" aria-label="포트폴리오 source">
      <FilterItem
        label="전체"
        count={allCount}
        active={activeFilter.kind === "all"}
        onClick={() => onFilterChange({ kind: "all" })}
      />

      {/* GitHub 그룹 */}
      {githubRepos.length > 0 ? (
        <>
          <SectionLabel
            label="GitHub"
            collapsed={collapse.github}
            onToggle={() =>
              setCollapse((c) => ({ ...c, github: !c.github }))
            }
          />
          {!collapse.github &&
            githubRepos.map(({ repo, count }) => (
              <FilterItem
                key={repo}
                label={renderRepo(repo)}
                count={count}
                active={
                  activeFilter.kind === "github" && activeFilter.repo === repo
                }
                onClick={() => onFilterChange({ kind: "github", repo })}
              />
            ))}
        </>
      ) : null}

      {/* 수동 폴더 그룹 */}
      <SectionLabel
        label="내가 만든 폴더"
        collapsed={collapse.manual}
        onToggle={() => setCollapse((c) => ({ ...c, manual: !c.manual }))}
      />
      {!collapse.manual && rootManualCount > 0 ? (
        <FilterItem
          label={<Text variant="caption" color="muted" as="span" className="text-xs">(폴더 없음)</Text>}
          count={rootManualCount}
          active={activeFilter.kind === "folder" && activeFilter.path === ""}
          onClick={() => onFilterChange({ kind: "folder", path: "" })}
        />
      ) : null}
      {!collapse.manual && topFolders.map((f) => {
        const isEditing = editing?.path === f.path;
        if (isEditing) {
          return (
            <div
              key={f.path}
              className="flex items-center gap-1.5 rounded-md px-2 py-1"
              style={{ backgroundColor: "var(--surface-3)" }}
            >
              <FolderOpen
                className="h-3 w-3 shrink-0"
                style={{ color: "var(--faint)" }}
              />
              <input
                ref={inputRef}
                type="text"
                value={editing.value}
                onChange={(e) =>
                  setEditing({ path: f.path, value: e.target.value })
                }
                onBlur={() => void commitEditing()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitEditing();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditing();
                  }
                }}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                placeholder="폴더 이름을 입력하세요"
                className="flex-1 rounded-sm bg-transparent px-1 py-0.5 text-sm outline-none"
                style={{
                  color: "var(--ink)",
                  border: "1px solid var(--line)",
                }}
              />
            </div>
          );
        }
        return (
          <div
            key={f.path}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ path: f.path, x: e.clientX, y: e.clientY });
            }}
          >
            <FilterItem
              label={f.name}
              count={folderCounts.get(f.path) ?? 0}
              leading={
                <Folder
                  className="h-3 w-3"
                  style={{ color: "var(--faint)" }}
                />
              }
              active={
                activeFilter.kind === "folder" && activeFilter.path === f.path
              }
              onClick={() => onFilterChange({ kind: "folder", path: f.path })}
            />
          </div>
        );
      })}

      {error ? (
        <Text
          variant="caption"
          as="p"
          className="mt-1 px-2 text-2xs"
          style={{ color: "var(--down-ink)" }}
        >
          {error}
        </Text>
      ) : null}

      {contextMenu ? (
        <ProjectContextMenu
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          name={
            folders.find((f) => f.path === contextMenu.path)?.name ??
            contextMenu.path
          }
          onRename={() => {
            const p = contextMenu.path;
            setContextMenu(null);
            startRename(p);
          }}
          onDelete={() => {
            const p = contextMenu.path;
            setContextMenu(null);
            void handleDelete(p);
          }}
        />
      ) : null}
    </nav>
  );
});

function SectionLabel({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-3 mb-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition hover:bg-[var(--surface-2)]"
      style={{ color: "var(--faint)" }}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <ChevronRight className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronDown className="h-3 w-3 shrink-0" />
      )}
      <Text
        variant="caption"
        color="muted"
        as="span"
        className="text-2xs tracking-wide"
      >
        {label}
      </Text>
    </button>
  );
}

// "owner/repo" → owner 작게 + repo 큰 라인. 본인이 한국어로 rename 한 경우 (slash 없음) 는 그대로.
function renderRepo(name: string): React.ReactNode {
  const slashIdx = name.indexOf("/");
  if (slashIdx < 0) return name;
  return (
    <span className="flex flex-col leading-tight">
      <Text
        variant="caption"
        color="muted"
        as="span"
        className="text-3xs"
      >
        {name.slice(0, slashIdx)}
      </Text>
      <span className="truncate">{name.slice(slashIdx + 1)}</span>
    </span>
  );
}

// 메모장 FolderContextMenu 패턴 통일 — 이름 변경 / 삭제.
const ProjectContextMenu = forwardRef<
  HTMLDivElement,
  {
    x: number;
    y: number;
    name: string;
    onRename: () => void;
    onDelete: () => void;
  }
>(function ProjectContextMenu({ x, y, name, onRename, onDelete }, ref) {
  const MENU_W = 200;
  const MENU_H = 88;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);
  return (
    <div
      ref={ref}
      className="fixed z-50 overflow-hidden rounded-md shadow-lg"
      style={{
        left,
        top,
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
        minWidth: MENU_W,
      }}
    >
      <Text
        variant="caption"
        color="muted"
        as="div"
        className="truncate px-3 pt-2 pb-1 text-2xs"
      >
        {name}
      </Text>
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
});
