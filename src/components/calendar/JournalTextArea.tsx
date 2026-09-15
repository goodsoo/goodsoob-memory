import { useEffect, type RefObject } from "react";

type Props = {
  content: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  // true: 내용 길이에 맞춰 높이 자동 증가(인라인 박스용). false: 컨테이너 높이를 채움(오버레이용).
  autoGrow?: boolean;
};

// 일기 전용 평문 textarea — 마크다운 편집기(SourceBodyEditor + 거터/문법) 대신. 소프트
// 줄바꿈, 문법 하이라이트 없음. 막상 일기는 평범한 텍스트로만 쓰게 돼서 단순화(2026-06-24).
// 폰트/크기는 감싸는 컨테이너(font-serif, text-[14/15px])를 그대로 상속.
export function JournalTextArea({
  content,
  onChange,
  onBlur,
  placeholder,
  textareaRef,
  autoGrow = false,
}: Props) {
  // 자동 높이 — 내용에 맞춰 textarea 가 늘어남(인라인). 자체 스크롤 대신 페이지 스크롤.
  useEffect(() => {
    if (!autoGrow) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content, autoGrow, textareaRef]);

  return (
    <textarea
      ref={textareaRef}
      value={content}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`w-full resize-none bg-transparent leading-relaxed outline-none ${autoGrow ? "overflow-hidden" : "h-full"}`}
      style={{
        color: "var(--ink)",
        fontFamily: "inherit",
        fontSize: "inherit",
      }}
    />
  );
}
