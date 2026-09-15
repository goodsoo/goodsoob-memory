import { useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import { Button } from "../common/Button";
import { Popover } from "../common/Popover";
import type { PortfolioSortKey } from "../../hooks/usePortfolioSort";

const SORT_OPTIONS: Array<{ id: PortfolioSortKey; label: string }> = [
  { id: "merged_desc", label: "최신 PR" },
  { id: "merged_asc", label: "오래된 PR" },
  { id: "category", label: "카테고리" },
  { id: "project", label: "프로젝트" },
  { id: "impact", label: "영향 큰 순" },
];

type Props = {
  value: PortfolioSortKey;
  onChange: (next: PortfolioSortKey) => void;
};

// 포트폴리오 정렬 picker — popover 안 라디오 menu. 본문 CategoryChipRow 의
// 오른쪽 끝에서 띄움 (옛 사이드바 헤더 자리에서 이동).
export function PortfolioSortMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="relative"
      panelClassName="absolute right-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-md shadow-md"
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
                <Check
                  className="h-3 w-3"
                  style={{ color: "var(--sub)" }}
                />
              ) : null}
            </Button>
          );
        })}
      </div>
    </Popover>
  );
}
