// DS Chip 의 `icon` 슬롯에 넣는 6px 원형 색점 노드 헬퍼.
// 카테고리/소스 색 표시용 — 포트폴리오 카드·상세·휴지통에서 반복돼 헬퍼로 유지.
// (DS Chip 은 dot prop 이 없고 icon 슬롯만 제공하므로 색점 생성은 consumer 소유.)
export function chipDot(color: string) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "9999px",
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
}
