import type { ReviewHighlight } from "../../lib/recordings/review";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

const TYPE_LABELS: Record<string, string> = {
  A: "잘못 들은 말",
  B: "확인 필요",
  C: "말한 사람이 틀림",
};

/** 교정 후보 하이라이트 팝오버 내용 — 원문 → 제안 · 메모 · 확신도 + 바꾸기 / 그대로 두기 / 직접 고치기. */
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
      {item.type === "C" ? (
        <Text variant="caption" color="secondary" as="div">
          문단 위 이름을 눌러 말한 사람을 바꿉니다.
        </Text>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {replacement !== null ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>
            바꾸기
          </Button>
        ) : null}
        <Button size="sm" disabled={busy} onClick={onKeep}>
          그대로 두기
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
          직접 고치기
        </Button>
      </div>
    </div>
  );
}
