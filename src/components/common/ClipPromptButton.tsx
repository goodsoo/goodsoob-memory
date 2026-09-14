import { useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { Button } from "./Button";

// design v2.3 2A: 일반화된 Claude 프롬프트 복사 버튼.
// meeting / PR / journal 등 모든 케이스에서 공유. caller 가 buildPrompt 를 전달.

type Variant = "outlined" | "compact";

type Props = {
  buildPrompt: () => string;
  disabled?: boolean;
  label?: string;
  title?: string;
  variant?: Variant;
  onError?: (message: string) => void;
};

export function ClipPromptButton({
  buildPrompt,
  disabled,
  label = "Claude 프롬프트 복사",
  title = "Claude 에 붙여넣을 프롬프트로 복사",
  variant = "outlined",
  onError,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const prompt = buildPrompt();
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : "클립보드에 복사하지 못했어요.",
      );
    }
  }

  if (variant === "compact") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={copy}
        disabled={disabled}
        title={title}
        leftIcon={
          copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )
        }
        className="font-normal"
        style={{
          backgroundColor: "var(--surface-2)",
          color: "var(--sub)",
        }}
      >
        {copied ? "복사됨" : label}
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      onClick={copy}
      disabled={disabled}
      title={title}
      leftIcon={
        copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )
      }
      className="rounded-lg px-3 py-2 font-normal"
    >
      {copied ? "복사됨" : label}
    </Button>
  );
}
