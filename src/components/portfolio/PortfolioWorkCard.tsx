import { useState } from "react";
import { Briefcase, Eye, Trash2 } from "lucide-react";
import { GithubMark } from "./GithubMark";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Chip } from "../common/Chip";
import {
  folderPathOfCard,
  isGithubCard,
  type PortfolioWorkMeta,
} from "../../api/portfolio";
import { formatDisplayDate } from "../../lib/dates";
import { useVault } from "../../lib/vault/useVault";
import { vaultAssetSrc } from "../../lib/portfolio/assetUrl";
import {
  useDeletePortfolioWork,
  useUpdatePortfolioFrontmatter,
} from "../../hooks/usePortfolio";
import {
  categoryColor as lookupCategoryColor,
  categoryLabel as lookupCategoryLabel,
} from "../../lib/portfolio/categoryLookup";
import { PortfolioCardMenu } from "./PortfolioCardMenu";
import { PortfolioDetailModal } from "./PortfolioDetailModal";

type Props = {
  work: PortfolioWorkMeta;
};

// F-1 카드 시각 위계 (portfolio-card-redesign):
//   1) 가로 row — 썸네일 96x72 left + 본문 right
//   2) impact_summary 메인 (14px semibold primary). 빈 카드는 dashed border + italic placeholder
//   3) PR 제목 = 부제 (11px mono secondary truncate)
//   4) 메타 row: 카테고리 dot chip + +N -M · n일 전
// 카드 본체 클릭 = PortfolioDetailModal — 큰 viewer + 모든 편집 통합.
// 우상단 "..." 메뉴 = 빠른 액션 (프로젝트 변경 / included 토글 / 영구 삭제 / Claude 프롬프트).
export function PortfolioWorkCard({ work }: Props) {
  const fm = work.frontmatter;
  const firstScreenshot = fm.screenshots[0];
  const dateLabel = fm.github_merged_at
    ? formatDisplayDate(fm.github_merged_at.slice(0, 10))
    : "";
  const categoryLabel = lookupCategoryLabel(fm.category);
  const categoryColor = lookupCategoryColor(fm.category);
  const isGithub = isGithubCard(fm);
  // source chip: github 카드 = repo 이름 (owner/repo 의 repo 부분), 수동 카드 = 폴더 path.
  // 수동 카드 root 면 chip 안 표시.
  const sourceChip = (() => {
    if (isGithub) {
      const repo = fm.github_repo;
      const full = `${fm.github_owner}/${fm.github_repo}`;
      return { label: repo, full };
    }
    const folder = folderPathOfCard(work.filePath);
    if (!folder) return null;
    const lastSeg = folder.split("/").pop() ?? folder;
    return { label: lastSeg, full: folder };
  })();
  const { adapter } = useVault();
  const vaultRoot = adapter.getRoot();
  const [modalOpen, setModalOpen] = useState(false);
  const updateFm = useUpdatePortfolioFrontmatter(work.prSlug);
  const deleteWork = useDeletePortfolioWork();

  const screenshotSrc = (path: string) => vaultAssetSrc(vaultRoot, path);
  const isEmpty = !fm.impact_summary;
  const excluded = !fm.included;

  const handleRestore = () => {
    updateFm.mutate({ included: true });
  };

  const handleDelete = () => {
    if (!window.confirm(`"${fm.github_title}" 카드를 휴지통으로 보냅니다. 진행할까요?`)) return;
    deleteWork.mutate(work.prSlug);
  };

  // 미사용 카드 (included: false) — 클릭으로 모달 진입 X, footer 에 inline 복원/삭제만.
  if (excluded) {
    return (
      <div
        className="relative flex w-full items-stretch gap-3 rounded-lg p-3"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line)",
          opacity: 0.7,
        }}
      >
        <div
          className="flex h-[72px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md"
          style={{
            backgroundColor: "var(--surface-2)",
            border: "1px solid var(--line-2)",
          }}
        >
          {firstScreenshot ? (
            <img
              src={screenshotSrc(firstScreenshot.path)}
              alt={firstScreenshot.caption || fm.github_title}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <EmptyThumb githubCard={isGithub} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Text
            variant="body"
            as="span"
            className="line-clamp-2 leading-snug"
            style={{
              color: isEmpty ? "var(--faint)" : "var(--ink)",
              fontStyle: isEmpty ? "italic" : "normal",
              fontWeight: isEmpty ? 500 : 600,
            }}
            title={fm.impact_summary || "한 줄 임팩트 추가 필요"}
          >
            {fm.impact_summary || "한 줄 임팩트 추가 필요"}
          </Text>
          <Text
            variant="caption"
            color="secondary"
            as="span"
            truncate
            className="font-mono text-2xs"
            title={fm.github_title}
          >
            {fm.github_title}
          </Text>
          <div className="mt-auto flex flex-nowrap items-center gap-x-1.5 overflow-hidden pt-1">
            {dateLabel ? (
              <Chip title={`병합일: ${fm.github_merged_at?.slice(0, 10) ?? ""}`}>
                {dateLabel}
              </Chip>
            ) : null}
            {sourceChip ? (
              <Chip title={sourceChip.full}>{sourceChip.label}</Chip>
            ) : null}
            <Chip dot={categoryColor} title={`카테고리: ${categoryLabel}`}>
              {categoryLabel}
            </Chip>
            <Chip
              style={{ color: "var(--faint)" }}
              title={`변경: +${fm.github_additions} −${fm.github_deletions} · ${fm.github_changed_files} files`}
            >
              +{fm.github_additions} −{fm.github_deletions}
            </Chip>
          </div>
          <div className="flex items-center justify-end gap-1.5 pt-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRestore}
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              className="whitespace-nowrap"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--ink)",
              }}
              title="평가 자료에 포함"
            >
              복원
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              className="whitespace-nowrap"
              style={{
                backgroundColor: "var(--down-soft)",
                color: "var(--down-ink)",
                border: "1px solid var(--down)",
              }}
              title="휴지통으로 보내기"
            >
              삭제
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setModalOpen(true);
          }
        }}
        className="group relative flex w-full cursor-pointer items-stretch gap-3 rounded-lg p-3 pr-9 text-left transition hover:border-[var(--faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        style={{
          backgroundColor: "var(--surface)",
          border: isEmpty
            ? "1px dashed var(--line)"
            : "1px solid var(--line)",
        }}
      >
        <div
          className="flex h-[72px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md"
          style={{
            backgroundColor: "var(--surface-2)",
            border: "1px solid var(--line-2)",
          }}
        >
          {firstScreenshot ? (
            <img
              src={screenshotSrc(firstScreenshot.path)}
              alt={firstScreenshot.caption || fm.github_title}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <EmptyThumb githubCard={isGithub} />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Text
            variant="body"
            as="span"
            className="line-clamp-2 leading-snug"
            style={{
              color: isEmpty ? "var(--faint)" : "var(--ink)",
              fontStyle: isEmpty ? "italic" : "normal",
              fontWeight: isEmpty ? 500 : 600,
            }}
            title={fm.impact_summary || "한 줄 임팩트 추가 필요"}
          >
            {fm.impact_summary || "한 줄 임팩트 추가 필요"}
          </Text>
          <Text
            variant="caption"
            color="secondary"
            as="span"
            truncate
            className="font-mono text-2xs"
            title={fm.github_title}
          >
            {fm.github_title}
          </Text>
          <div className="mt-auto flex flex-nowrap items-center gap-x-1.5 overflow-hidden pt-1">
            {dateLabel ? (
              <Chip title={`병합일: ${fm.github_merged_at?.slice(0, 10) ?? ""}`}>
                {dateLabel}
              </Chip>
            ) : null}
            {sourceChip ? (
              <Chip title={sourceChip.full}>{sourceChip.label}</Chip>
            ) : null}
            <Chip dot={categoryColor} title={`카테고리: ${categoryLabel}`}>
              {categoryLabel}
            </Chip>
            <Chip
              style={{ color: "var(--faint)" }}
              title={`변경: +${fm.github_additions} −${fm.github_deletions} · ${fm.github_changed_files} files`}
            >
              +{fm.github_additions} −{fm.github_deletions}
            </Chip>
          </div>
        </div>

        {/* "..." 메뉴 — 카드 클릭과 분리 (stopPropagation) */}
        <div
          className="absolute right-2 top-2"
          onClick={(e) => e.stopPropagation()}
        >
          <PortfolioCardMenu work={work} />
        </div>
      </div>

      {modalOpen ? (
        <PortfolioDetailModal
          work={work}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}

// 빈 썸네일 자리 아이콘 — github 카드는 Mark 로고, 수동 카드는 file 아이콘.
function EmptyThumb({ githubCard }: { githubCard: boolean }) {
  if (githubCard) {
    return (
      <GithubMark
        className="h-5 w-5"
        style={{ color: "var(--faint)" }}
      />
    );
  }
  return (
    <Briefcase
      className="h-5 w-5"
      strokeWidth={1.5}
      style={{ color: "var(--faint)" }}
    />
  );
}
