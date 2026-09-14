import { RefreshCw } from "lucide-react";
import { useGcalSync } from "../../hooks/useGcalSync";
import { Button } from "../common/Button";
import { Chip } from "../common/Chip";
import { GoogleIcon } from "../common/GoogleIcon";
import { Spinner } from "../common/Spinner";

// 마지막 동기화 시각 → 상대 표현 (버튼 tooltip 용).
function relativeSince(iso: string | null): string {
  if (!iso) return "아직 동기화 안 함";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "아직 동기화 안 함";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

// 할 일 헤더의 동기화 칩 — 연동된 Google 캘린더를 tag 로 표시 + 수동 "지금 동기화"
// 버튼. 동기화는 포커스 시 자동이지만 즉시 반영이 필요할 때 직접 당긴다. 연동 +
// 전용 캘린더 있을 때만 노출.
export function SyncStatusChip() {
  const sync = useGcalSync();
  if (!sync.connected) return null;

  const syncing = sync.status === "syncing";
  const problem = sync.needsReauth || sync.status === "error";
  const name = sync.calendarName ?? "goodsoob";

  const buttonTitle = syncing
    ? "동기화 중"
    : sync.needsReauth
      ? "재연동이 필요합니다"
      : sync.status === "error"
        ? "동기화 오류. 다시 시도하세요"
        : sync.autoSyncEnabled
          ? `지금 동기화 · 마지막 ${relativeSince(sync.lastSyncAt)}`
          : "지금 동기화 · 자동 동기화 꺼짐";

  return (
    <div className="flex items-center gap-1.5">
      <Chip
        variant="accent"
        size="sm"
        leading={<GoogleIcon className="h-3 w-3 shrink-0" />}
        className="hidden max-w-[13rem] sm:inline-flex"
        title={`Google 캘린더-${name}`}
      >
        <span className="min-w-0 truncate">{name}</span>
      </Chip>
      <Button
        variant="ghost"
        onClick={() => void sync.syncNow()}
        disabled={syncing}
        title={buttonTitle}
        aria-label="지금 동기화"
        className="rounded-md px-1.5 py-1 disabled:opacity-50"
        style={{ color: problem ? "var(--down)" : "var(--sub)" }}
      >
        {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
