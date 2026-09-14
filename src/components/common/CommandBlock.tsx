import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./Button";

type Props = {
  command: string;
  // 부제 (예: "터미널에서 실행"). 명령어 위 caption.
  caption?: string;
  // 인접 모달 안에서 여러 블록 쌓일 때 size compact 로.
  size?: "md" | "sm";
};

// gh 설치/로그인 가이드 + portfolio guidebook 의 명령어 한 줄용. 클릭 = 클립보드 복사,
// 1.5초 동안 "복사됨" 표시 후 원상 복귀. Tauri/web 모두 navigator.clipboard 의존.
export function CommandBlock({ command, caption, size = "md" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent — clipboard 권한 거부 시 fallback 없음 (Tauri 데스크탑 기본 권한 OK).
    }
  }

  const padding = size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2";
  const fontSize = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className="flex flex-col gap-1">
      {caption ? (
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--faint)" }}
        >
          {caption}
        </span>
      ) : null}
      <div
        className={`flex items-center gap-2 rounded-md ${padding}`}
        style={{
          backgroundColor: "var(--surface-2)",
          border: "1px solid var(--line)",
        }}
      >
        <code
          className={`flex-1 overflow-x-auto font-mono ${fontSize} whitespace-nowrap`}
          style={{ color: "var(--ink)" }}
        >
          {command}
        </code>
        <Button
          variant="icon"
          onClick={copy}
          title={copied ? "복사됨" : "명령어 복사"}
          aria-label={copied ? "복사됨" : "명령어 복사"}
          className="shrink-0 rounded-sm p-1"
          style={{
            color: "var(--sub)",
            minHeight: 0,
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
