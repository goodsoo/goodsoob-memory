import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import {
  isGithubCard,
  type PortfolioWorkMeta,
} from "../../api/portfolio";
import {
  useDeletePortfolioWork,
  useUpdatePortfolioFrontmatter,
} from "../../hooks/usePortfolio";
import { Button } from "../common/Button";
import { PortfolioMoveFolderModal } from "./PortfolioMoveFolderModal";

type Props = {
  work: PortfolioWorkMeta;
};

// 카드 메뉴:
//   "미사용 / 포함" (included 토글)
//   ─────
//   "삭제" (accent-red-text, confirm)
export function PortfolioCardMenu({ work }: Props) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const updateFm = useUpdatePortfolioFrontmatter(work.prSlug);
  const deleteWork = useDeletePortfolioWork();
  const isGithub = isGithubCard(work.frontmatter);

  // 외부 클릭 닫기 + ESC
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
  };

  const handleIncludedToggle = () => {
    const fm = work.frontmatter;
    if (fm.included) {
      const ok = window.confirm(
        `"${fm.github_title}" 을(를) 평가 자료에서 제외합니다. 사이드바 "미사용" 필터에서 다시 켤 수 있어요.`,
      );
      if (!ok) {
        close();
        return;
      }
    }
    updateFm.mutate({ included: !fm.included });
    close();
  };

  const handleDelete = () => {
    const ok = window.confirm(
      `"${work.frontmatter.github_title}" 카드를 휴지통으로 보냅니다. 진행할까요?`,
    );
    if (!ok) return;
    deleteWork.mutate(work.prSlug);
    close();
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="icon"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="카드 메뉴"
        style={{ color: "var(--faint)" }}
      >
        <MoreVertical className="h-4 w-4" />
      </Button>

      {open ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-10 w-44 overflow-visible rounded-lg py-1 text-sm shadow-lg"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          {!isGithub ? (
            <>
              <MenuItem
                label="폴더로 이동..."
                onClick={() => {
                  close();
                  setMoveOpen(true);
                }}
              />
              <div
                className="my-1 h-px"
                style={{ backgroundColor: "var(--line)" }}
              />
            </>
          ) : null}
          <MenuItem
            label={work.frontmatter.included ? "미사용" : "포함"}
            onClick={handleIncludedToggle}
          />
          <MenuItem
            label="삭제"
            danger
            onClick={handleDelete}
          />
        </div>
      ) : null}

      {moveOpen ? (
        <PortfolioMoveFolderModal
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          work={work}
        />
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  danger,
  trailing,
  onClick,
  onMouseEnter,
}: {
  label: string;
  danger?: boolean;
  trailing?: React.ReactNode;
  onClick: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="w-full justify-between rounded-none px-3 py-1.5 font-normal"
      style={{
        color: danger ? "var(--down-ink)" : "var(--ink)",
      }}
    >
      <span>{label}</span>
      {trailing ?? null}
    </Button>
  );
}

