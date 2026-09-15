import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FolderPlus,
  KeyRound,
  Plus,
  X,
} from "lucide-react";
import {
  usePortfolioWorks,
  type GhSyncProgress,
} from "../../hooks/usePortfolio";
import { GhAuthError, GhNotInstalledError } from "../../lib/portfolio/gh";
import {
  PortfolioSourceTree,
  type PortfolioSourceTreeHandle,
  type SourceFilter,
} from "./PortfolioSourceTree";
import { PortfolioCreateModal } from "./PortfolioCreateModal";
import { SyncButton } from "./SyncButton";
import { Button } from "../common/Button";
import { FilterItem } from "../common/FilterItem";
import { Text } from "../common/Text";

type Props = {
  activeFilter: SourceFilter;
  onFilterChange: (next: SourceFilter) => void;
  syncState: GhSyncProgress;
  onSyncRun: () => void;
  onSyncCancel: () => void;
  // 사이드바 inline 에러 row 트리거 — gh 설치/로그인 가이드 모달 열기.
  onOpenInstallGuide: () => void;
  onOpenAuthGuide: () => void;
  onDismissSyncError: () => void;
};

export function PortfolioSidePanel({
  activeFilter,
  onFilterChange,
  syncState,
  onSyncRun,
  onSyncCancel,
  onOpenInstallGuide,
  onOpenAuthGuide,
  onDismissSyncError,
}: Props) {
  const works = usePortfolioWorks();
  const [createOpen, setCreateOpen] = useState(false);
  const sourceTreeRef = useRef<PortfolioSourceTreeHandle>(null);

  // "미사용" entry 의 count — included=false 인 카드 수. 0 이어도 항상 노출
  // (할 일 사이드바 "취소됨" 패턴과 동일).
  const excludedCount = useMemo(
    () => (works.data ?? []).filter((w) => !w.frontmatter.included).length,
    [works.data],
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* 헤더 — 메모장 패턴 통일 (페이지 헤더 높이 + 우측 icon row) */}
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
          포트폴리오
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="icon"
            onClick={() => sourceTreeRef.current?.createAndEdit()}
            title="새 폴더"
            aria-label="새 폴더"
            style={{ color: "var(--sub)" }}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button
            variant="icon"
            onClick={() => setCreateOpen(true)}
            title="새 카드 — PR 없이 직접 추가"
            aria-label="새 카드"
            style={{ color: "var(--sub)" }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 동기화 + 상태 — 헤더 아래 별도 영역. */}
      <div
        className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-3"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <SyncButton
          state={syncState}
          onRun={onSyncRun}
          onCancel={onSyncCancel}
        />
        {!syncState.running && syncState.error ? (
          <SyncErrorRow
            error={syncState.error}
            onOpenInstallGuide={onOpenInstallGuide}
            onOpenAuthGuide={onOpenAuthGuide}
            onDismiss={onDismissSyncError}
          />
        ) : null}
        {!syncState.running && syncState.lastResult && !syncState.error ? (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-3 py-1.5 text-xs"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--sub)",
            }}
          >
            <span>
              <span
                title="이번에 새로 추가된 PR — vault 에 카드가 처음 만들어진 것"
                style={{ cursor: "help" }}
              >
                새 카드 {syncState.lastResult.added}
              </span>
              {" · "}
              <span
                title="이미 있던 카드의 GitHub 정보 (제목/머지일/통계) 만 새로 받아옴. 본인이 수정한 필드 (한 줄 임팩트/카테고리/스크린샷) 는 그대로 보존"
                style={{ cursor: "help" }}
              >
                갱신 {syncState.lastResult.preserved}
              </span>
              {" · "}
              <span title="GitHub 에서 가져온 머지된 PR 전체 갯수">
                전체 {syncState.lastResult.total}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        <PortfolioSourceTree
          ref={sourceTreeRef}
          works={works.data ?? []}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        />
      </div>

      {/* 미사용 — 사이드바 하단 별도 entry. 할 일 "취소됨" 패턴과 동일. */}
      <div
        className="px-1 py-2"
        style={{ borderTop: "1px solid var(--line)" }}
      >
        <FilterItem
          label="미사용"
          count={excludedCount}
          muted
          active={activeFilter.kind === "excluded"}
          onClick={() => onFilterChange({ kind: "excluded" })}
        />
      </div>

      <PortfolioCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

// SortMenu 는 PortfolioSortMenu.tsx 로 분리되어 본문 CategoryChipRow 의 오른쪽 끝에서 띄움.
// 가이드북은 PortfolioSidePanelFooter 의 BookOpen 버튼이 App.tsx 의 PortfolioGuideModal 트리거.

// sync error 시 사이드바 inline — 모달이 자동 뜨지만 닫은 후 다시 열 수 있도록 사이드바에도
// "어떤 에러였는지 + 다시 안내 열기" 트리거. 일반 (네트워크 등) 에러는 메시지만.
function SyncErrorRow({
  error,
  onOpenInstallGuide,
  onOpenAuthGuide,
  onDismiss,
}: {
  error: Error;
  onOpenInstallGuide: () => void;
  onOpenAuthGuide: () => void;
  onDismiss: () => void;
}) {
  let icon = <AlertCircle className="h-3.5 w-3.5 shrink-0" />;
  let label = "동기화 실패";
  let detail = "네트워크 연결을 확인하세요.";
  let action: { label: string; onClick: () => void } | null = null;

  if (error instanceof GhNotInstalledError) {
    icon = <Download className="h-3.5 w-3.5 shrink-0" />;
    label = "gh CLI 가 설치되지 않았습니다";
    detail = "터미널에서 설치 후 다시 시도하세요.";
    action = { label: "설치 가이드", onClick: onOpenInstallGuide };
  } else if (error instanceof GhAuthError) {
    icon = <KeyRound className="h-3.5 w-3.5 shrink-0" />;
    label = "GitHub 로그인이 필요합니다";
    detail = "gh auth login 후 다시 시도하세요.";
    action = { label: "로그인 가이드", onClick: onOpenAuthGuide };
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-md px-3 py-2 text-xs"
      style={{
        backgroundColor: "color-mix(in srgb, var(--down) 10%, var(--surface))",
        border: "1px solid color-mix(in srgb, var(--down) 35%, transparent)",
        color: "var(--ink)",
      }}
    >
      <div
        className="flex items-start gap-1.5"
        style={{ color: "var(--down)" }}
      >
        {icon}
        <span className="flex-1 font-medium">{label}</span>
        <Button
          variant="icon"
          onClick={onDismiss}
          title="알림 닫기"
          aria-label="알림 닫기"
          className="-mr-1 -mt-0.5 shrink-0 rounded-sm p-0.5"
          style={{ color: "var(--down)", minHeight: 0 }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Text variant="caption" color="secondary" as="p" className="text-2xs leading-snug">
        {detail}
      </Text>
      {action ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={action.onClick}
          className="self-start px-2 py-1 text-2xs"
          style={{
            color: "var(--down)",
            textDecoration: "underline",
            minHeight: 0,
          }}
        >
          {action.label} 열기
        </Button>
      ) : null}
    </div>
  );
}
