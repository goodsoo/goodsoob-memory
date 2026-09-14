// V0.7.3 — 카테고리는 옵시디안 tag 처럼 vault 카드의 frontmatter union 으로 자연
// 발생. master list 가 없으므로 label = slug 그대로, color = 단일 회색 chip.
// 색 욕구가 생기면 별도 colors.md 도입 (지금은 X).

export const CATEGORY_CHIP_COLOR = "var(--faint)";

export function categoryLabel(slug: string): string {
  return slug;
}

export function categoryColor(_slug: string): string {
  return CATEGORY_CHIP_COLOR;
}
