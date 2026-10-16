import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Dropdown, Button, type DropdownItem } from "@goodsoob/ds";
import {
  isGithubCard,
  type PortfolioWorkMeta,
} from "../../api/portfolio";
import {
  useDeletePortfolioWork,
  useUpdatePortfolioFrontmatter,
} from "../../hooks/usePortfolio";
import { PortfolioMoveFolderModal } from "./PortfolioMoveFolderModal";

type Props = {
  work: PortfolioWorkMeta;
};

// 카드 메뉴 — DS Dropdown. (Phase 4 conform: 자체 open/외부클릭/ESC/absolute panel +
// 토큰 override 를 DS Dropdown 으로 교체. 구분선 = separator item, 삭제 = tone 'danger'.)
//   "폴더로 이동..." (비-github 만)
//   ─────
//   "미사용 / 포함" (included 토글)
//   "삭제" (danger, confirm)
export function PortfolioCardMenu({ work }: Props) {
  const [moveOpen, setMoveOpen] = useState(false);

  const updateFm = useUpdatePortfolioFrontmatter(work.prSlug);
  const deleteWork = useDeletePortfolioWork();
  const isGithub = isGithubCard(work.frontmatter);

  const handleIncludedToggle = () => {
    const fm = work.frontmatter;
    if (fm.included) {
      const ok = window.confirm(
        `"${fm.github_title}" 을(를) 평가 자료에서 제외합니다. 사이드바 "미사용" 필터에서 다시 켤 수 있어요.`,
      );
      if (!ok) return;
    }
    updateFm.mutate({ included: !fm.included });
  };

  const handleDelete = () => {
    const ok = window.confirm(
      `"${work.frontmatter.github_title}" 카드를 휴지통으로 보냅니다. 진행할까요?`,
    );
    if (!ok) return;
    deleteWork.mutate(work.prSlug);
  };

  const items: DropdownItem[] = [];
  if (!isGithub) {
    items.push({ key: "move", label: "폴더로 이동...", onSelect: () => setMoveOpen(true) });
    items.push({ key: "sep", separator: true });
  }
  items.push({
    key: "included",
    label: work.frontmatter.included ? "미사용" : "포함",
    onSelect: handleIncludedToggle,
  });
  items.push({ key: "delete", label: "삭제", tone: "danger", onSelect: handleDelete });

  return (
    <>
      <Dropdown
        trigger={
          <Button
            variant="ghost"
            iconOnly
            title="카드 메뉴"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        }
        items={items}
      />

      {moveOpen ? (
        <PortfolioMoveFolderModal
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          work={work}
        />
      ) : null}
    </>
  );
}
