/**
 * SyncIndicator (T5) — 미sync outbox op 개수를 타이틀바에 눈에 보이게 표시.
 *
 * design 실패모드 #1(iOS eviction → 유실)의 방어선. 미sync 항목이 0 이면 아무것도 안 보이고,
 * 1개 이상이면 경고색 배지 + 개수. 클릭하면 즉시 flush 를 시도한다(포그라운드/online 자동
 * flush 외 수동 트리거).
 */

import { CloudOff } from "lucide-react";
import { useOutboxCount } from "../../hooks/useOutboxCount";
import { useVault } from "../../lib/vault/useVault";

export function SyncIndicator() {
  const count = useOutboxCount();
  const { adapter } = useVault();

  if (count <= 0) return null;

  const label = `미전송 ${count}건 — 서버 연결 시 자동으로 올립니다`;

  // offline 어댑터는 concurrency-guarded flush() 를 노출. 다른 어댑터면 no-op.
  const flush = (adapter as { flush?: () => Promise<void> }).flush;

  return (
    <button
      type="button"
      onClick={() => void flush?.()}
      title={label}
      aria-label={label}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5"
      style={{
        color: "var(--warn)",
        backgroundColor: "var(--warn-soft)",
        border: "1px solid var(--warn-line)",
      }}
    >
      <CloudOff className="h-3.5 w-3.5" />
      <span className="text-xs font-medium tabular-nums">{count}</span>
    </button>
  );
}
