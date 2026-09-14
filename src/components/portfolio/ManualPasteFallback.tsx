import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { ResponsePasteArea } from "./ResponsePasteArea";

// 수동 paste fallback — runClaude 주 경로가 실패(미설치/인증/파싱)하면 자동으로
// 펼쳐 외부 Claude 응답 붙여넣기 경로를 곧장 보여줍니다. 정상 흐름에선 접힌 채로
// 둡니다 (주 경로가 자동 채움이라 평소엔 군더더기).

// summary 라벨 — 요청 에러가 있으면 외부 Claude 경로 안내, 없으면 기존 라벨.
export function manualFallbackSummary(requestError: string | null): string {
  return requestError
    ? "claude CLI 가 없으면 외부 Claude 응답을 붙여넣으세요"
    : "직접 입력 (수동 paste)";
}

type Props = {
  requestError: string | null;
  promptCopied: boolean;
  copyDisabled: boolean;
  onCopyPrompt: () => void;
  onParsed: (impact: string, category: string) => void;
};

export function ManualPasteFallback({
  requestError,
  promptCopied,
  copyDisabled,
  onCopyPrompt,
  onParsed,
}: Props) {
  const [open, setOpen] = useState(false);

  // 요청 에러가 새로 생기면 fallback 을 자동으로 펼칩니다. 이후 사용자가 직접
  // 접으면 그 상태를 유지합니다 (에러 값이 그대로라 effect 가 재발화하지 않음).
  useEffect(() => {
    if (requestError) setOpen(true);
  }, [requestError]);

  return (
    <details
      className="mt-1"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <Text
        variant="caption"
        color="muted"
        as="summary"
        className="cursor-pointer text-[11px]"
      >
        {manualFallbackSummary(requestError)}
      </Text>
      <div className="mt-2 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onCopyPrompt}
          disabled={copyDisabled}
          leftIcon={
            promptCopied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )
          }
          className="self-start px-2.5 py-1 disabled:opacity-50"
          style={{
            backgroundColor: "var(--surface-2)",
            color: "var(--ink)",
          }}
        >
          {promptCopied ? "복사됨" : "프롬프트 복사"}
        </Button>
        <ResponsePasteArea onParsed={onParsed} />
      </div>
    </details>
  );
}
