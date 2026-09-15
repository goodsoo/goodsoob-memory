import { Text } from "../common/Text";

type Example = { inputs: string[]; output: string };

const DATE_EXAMPLES: Example[] = [
  { inputs: ["오늘", "내일", "어제"], output: "자연어" },
  { inputs: ["월", "금요일"], output: "가장 최근 그 요일" },
  { inputs: ["2026.05.04", "2026/05/04", "2026-05-04"], output: "전체 날짜" },
  { inputs: ["5/4", "5.4", "5 4"], output: "올해 5월 4일" },
  { inputs: ["20260504", "260504"], output: "압축 yyyymmdd / yymmdd" },
  { inputs: ["2026년 5월 4일"], output: "한글 단위" },
];

const TIME_EXAMPLES: Example[] = [
  { inputs: ["18:30", "18시 30분"], output: "기본" },
  { inputs: ["오후 6:30", "6:30 PM"], output: "12시간제" },
  { inputs: ["1830", "0930"], output: "압축 HHmm" },
];

const TASK_EXAMPLES: Example[] = [
  { inputs: ["- [ ] 보고서 --- 내일 14:00 #work #high"], output: "전체 형식" },
  { inputs: ["- [x] 이미 완료"], output: "체크 상태도 그대로" },
  { inputs: ["--- 내일", "--- 월", "--- 2026-05-22"], output: "날짜 (자연어 / 요일 / ISO 등 위 '날짜 입력' 표 전부 사용 가능)" },
  { inputs: ["HH:MM", "오후 2시", "1830"], output: "시간 (위 '시간 입력' 표 전부 사용 가능)" },
  { inputs: ["#work", "#meeting"], output: "카테고리" },
  { inputs: ["#high", "#medium", "#low"], output: "우선순위" },
];

const LINEBREAK_EXAMPLES: Example[] = [
  { inputs: ["Enter"], output: "한 번이면 다음 줄로 줄바꿈" },
  { inputs: ["Enter 2번 (빈 줄)"], output: "문단 띄우기 (간격 넓게)" },
];

export function HelpSection() {
  return (
    <div className="space-y-5">
      <Block title="날짜 입력" examples={DATE_EXAMPLES} />
      <Block title="시간 입력" examples={TIME_EXAMPLES} />
      <Block
        title="메모 → 할 일 (cursor 줄 위 ⌘⏎)"
        examples={TASK_EXAMPLES}
      />
      <Block title="메모 본문 줄바꿈" examples={LINEBREAK_EXAMPLES} />
    </div>
  );
}

function Block({ title, examples }: { title: string; examples: Example[] }) {
  return (
    <section>
      <Text
        variant="caption"
        color="muted"
        as="h3"
        weight="semibold"
        className="mb-2 uppercase tracking-wide"
      >
        {title}
      </Text>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-6">
        {examples.map((e, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            <div className="flex flex-wrap items-center gap-1">
              {e.inputs.map((s, j) => (
                <code
                  key={j}
                  className="rounded px-1.5 py-0.5 text-xs"
                  style={{
                    background: "var(--bg)",
                    color: "var(--ink)",
                    border: "1px solid var(--line-2)",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  {s}
                </code>
              ))}
            </div>
            <Text variant="caption" color="muted" as="span">
              {e.output}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}
