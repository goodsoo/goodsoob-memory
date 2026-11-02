import type { ReviewHighlight } from "../../lib/recordings/review";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

const TYPE_LABELS: Record<string, string> = {
  A: "오인식",
  B: "확인 필요",
  C: "화자 오귀속",
};

/** 교정 후보 하이라이트 팝오버 내용 — 원문 → 제안 · 메모 · 확신도 + 수락 / 원문 유지 / 직접 고침. */
export function ReviewDetail({
  highlight,
  busy,
  onAccept,
  onKeep,
  onEdit,
}: {
  highlight: ReviewHighlight;
  busy: boolean;
  onAccept: () => void;
  onKeep: () => void;
  onEdit: () => void;
}) {
  const { item, needle, replacement } = highlight;
  // 확신도는 교정 프롬프트가 "-"(미기재)로 채우기도 한다 → 값 있을 때만.
  const conf = item.conf && item.conf.trim() !== "-" ? item.conf : null;
  const meta = [TYPE_LABELS[item.type] ?? item.type, conf ? `확신 ${conf}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-2" data-testid="review-detail">
      <div className="text-sm leading-relaxed" style={{ color: "var(--ink)", wordBreak: "keep-all" }}>
        {/* 취소선은 바꿀 말이 있을 때만 — 플래그(B)는 원문이 지워질 것처럼 보이면 안 된다. */}
        <span
          style={{
            color: "var(--sub)",
            textDecoration: replacement !== null ? "line-through" : undefined,
          }}
        >
          {needle}
        </span>
        {replacement !== null ? (
          <>
            <span style={{ color: "var(--faint)" }}> → </span>
            <span className="font-semibold">{replacement}</span>
          </>
        ) : null}
      </div>
      {item.note ? (
        <Text variant="caption" color="secondary" as="div">
          {item.note}
        </Text>
      ) : null}
      <Text variant="caption" color="muted" as="div">
        {meta}
      </Text>
      <div className="flex flex-wrap gap-2 pt-1">
        {replacement !== null ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>
            수락
          </Button>
        ) : null}
        <Button size="sm" disabled={busy} onClick={onKeep}>
          원문 유지
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
          직접 고침
        </Button>
      </div>
    </div>
  );
}
