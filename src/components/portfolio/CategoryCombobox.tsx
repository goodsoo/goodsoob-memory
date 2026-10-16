import { usePortfolioCategories } from "../../hooks/usePortfolio";
import { Combobox } from "@goodsoob/ds";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

// 카테고리 입력 — vault union 의 카드 frontmatter.category 들을 자동완성 후보로.
// 매치 없는 입력을 commit 하면 새 카테고리 생성 (옵시디안 tag 패턴). 모든 카테고리가
// 동등 — master list / builtin / 색 구분 없음.
//
// Phase 4 conform: 자체 285줄 구현(수제 popover/필터/키보드네비/portal)을 DS Combobox
// (creatable)로 교체. 필터·키보드네비(↑↓/Enter/Esc)·portal·create 행 전부 DS 소유.
// ⚠️ 동작 변화: 원본은 blur 만 해도 draft 를 commit 했으나, DS Combobox 는 표준대로
// create 행을 Enter/클릭으로 명시 선택해야 commit(실수 생성 방지). 빈/미선택 commit 은
// 옛 값 유지.
export function CategoryCombobox({
  value,
  onChange,
  placeholder = "카테고리를 입력하세요",
  autoFocus,
  className,
}: Props) {
  const categories = usePortfolioCategories();
  return (
    <Combobox
      items={categories}
      value={value}
      onValueChange={(next) => {
        if (next != null) onChange(next);
      }}
      creatable
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={className}
      aria-label="카테고리"
    />
  );
}
