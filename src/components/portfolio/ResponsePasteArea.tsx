import { useState } from "react";
import { parsePRResponse } from "../../lib/clipboardPrompt";
import { Text } from "../common/Text";

// design v2.3 step 8: Claude 응답 paste → H3 split parsing → frontmatter 채움.
// 파싱 성공 시 onParsed 콜백, 실패 시 raw 텍스트 보존 + "직접 입력" 안내.

type Props = {
  onParsed: (impact: string, category: string) => void;
  onError?: (message: string) => void;
};

export function ResponsePasteArea({ onParsed, onError }: Props) {
  const [raw, setRaw] = useState("");
  const [unparsed, setUnparsed] = useState(false);

  const tryParse = (text: string) => {
    const parsed = parsePRResponse(text);
    if (parsed) {
      onParsed(parsed.impact, parsed.category);
      setRaw("");
      setUnparsed(false);
    } else {
      setUnparsed(true);
      onError?.(
        "Claude 응답 파싱 실패. 형식이 다르면 직접 입력해주세요.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setUnparsed(false);
        }}
        onPaste={(e) => {
          // paste 직후 자동 파싱 시도 (delay 없이 e.clipboardData 사용)
          const text = e.clipboardData.getData("text");
          if (text) {
            // setRaw 는 다음 tick — 직접 파싱 호출
            queueMicrotask(() => tryParse(text));
          }
        }}
        rows={2}
        placeholder="Claude 응답 붙여넣기..."
        className="w-full resize-y rounded-md px-2 py-1.5 text-xs transition"
        style={{
          backgroundColor: "var(--surface)",
          border: `1px solid ${unparsed ? "var(--down)" : "var(--line)"}`,
          color: "var(--ink)",
        }}
      />
      {unparsed ? (
        <Text
          variant="caption"
          as="span"
          className="text-[11px]"
          style={{ color: "var(--down-ink)" }}
        >
          응답 형식 못 알아봄 — 직접 입력
        </Text>
      ) : null}
    </div>
  );
}
