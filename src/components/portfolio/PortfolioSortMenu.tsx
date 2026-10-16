import { ArrowUpDown } from "lucide-react";
import { Dropdown, Button } from "@goodsoob/ds";
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

// 포트폴리오 정렬 picker — DS Dropdown(라디오 메뉴). 현재 정렬은 Dropdown 의
// selected 하이라이트로 표시된다(별도 Check 아이콘 불필요). 본문 CategoryChipRow
// 오른쪽 끝에서 띄움. (Phase 4 conform: 자체 common/Popover + 토큰 override →
// DS Dropdown. open/외부클릭/ESC/패널 스타일은 DS 가 내부 처리. TaskSortMenu 동일.)
export function PortfolioSortMenu({ value, onChange }: Props) {
  return (
    <Dropdown
      trigger={
        <Button variant="ghost" iconOnly title="정렬" aria-label="정렬">
          <ArrowUpDown className="h-3.5 w-3.5" />
        </Button>
      }
      items={SORT_OPTIONS.map((opt) => ({
        key: opt.id,
        label: opt.label,
        selected: opt.id === value,
        onSelect: () => onChange(opt.id),
      }))}
    />
  );
}
