import { RefreshCw, X } from "lucide-react";
import type { GhSyncProgress } from "../../hooks/usePortfolio";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

type Props = {
  state: GhSyncProgress;
  onRun: () => void;
  onCancel: () => void;
};

// design v2.3: 사이드바 헤더의 동기화 트리거. 진행 중이면 같은 자리에 progress + 취소.
// 취소는 Tauri invoke 가 hang 된 경우 (dev full-reload 후) stuck 회복용.
export function SyncButton({ state, onRun, onCancel }: Props) {
  if (state.running) {
    const pct =
      state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
    return (
      <Text
        variant="caption"
        color="secondary"
        as="div"
        className="flex flex-col gap-1.5 rounded-md px-3 py-2"
        style={{ backgroundColor: "var(--surface-3)" }}
      >
        <div className="flex items-center justify-between">
          <span>동기화 중...</span>
          <div className="flex items-center gap-2">
            <span>
              {state.current}/{state.total || "?"}
            </span>
            <Button
              variant="icon"
              onClick={onCancel}
              title="동기화 취소"
              aria-label="동기화 취소"
              className="rounded-sm p-1"
              style={{
                color: "var(--ink)",
                backgroundColor: "var(--surface)",
                minHeight: 0,
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div
          className="relative h-1 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--surface-2)" }}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width]"
            style={{
              width: `${pct}%`,
              backgroundColor: "var(--btn-primary)",
            }}
          />
        </div>
      </Text>
    );
  }

  return (
    <Button
      variant="primary"
      onClick={onRun}
      leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
      className="px-3 py-2"
    >
      동기화
    </Button>
  );
}
