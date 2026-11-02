import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@goodsoob/ds";
import { recordingHash } from "../../lib/recordings/hash";

// 음성 기록 탭 옆 녹음 배지 — audio: 가 있을 때만. 1개면 바로 #recording-{base},
// 2개 이상이면 작은 목록 popover.
export function RecordingBadge({ audio }: { audio: readonly string[] }) {
  const [open, setOpen] = useState(false);
  if (audio.length === 0) return null;
  const href = recordingHash;
  const btnStyle = {
    border: "1px solid var(--line)",
    color: "var(--ink)",
    backgroundColor: "transparent",
  } as const;

  if (audio.length === 1) {
    return (
      <a
        href={href(audio[0])}
        title="녹음 탭에서 열기"
        aria-label="녹음 1개 열기"
        className="inline-flex items-center gap-1 rounded-full px-2 text-xs"
        style={btnStyle}
      >
        <Mic size={12} />1
      </a>
    );
  }
  return (
    <span className="relative inline-flex">
      <Button
        variant="secondary"
        size="sm"
        title="연결된 녹음"
        aria-label={`녹음 ${audio.length}개`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        leftIcon={<Mic size={12} />}
      >
        {audio.length}
      </Button>
      {open ? (
        <div
          className="absolute left-0 top-full z-20 mt-1 flex flex-col rounded p-1 text-sm"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--line)",
            minWidth: "12rem",
          }}
        >
          {audio.map((b) => (
            <a
              key={b}
              href={href(b)}
              className="rounded px-2 py-1 truncate"
              style={{ color: "var(--ink)" }}
              onClick={() => setOpen(false)}
            >
              {b}
            </a>
          ))}
        </div>
      ) : null}
    </span>
  );
}
