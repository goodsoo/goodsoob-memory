import { Text } from "../common/Text";
import { Kbd } from "../common/Kbd";

type Shortcut = {
  keys: string[];
  label: string;
  note?: string;
};

type Group = {
  title: string;
  items: Shortcut[];
};

const GROUPS: Group[] = [
  {
    title: "페이지 이동",
    items: [
      { keys: ["⌘", "1"], label: "오늘" },
      { keys: ["⌘", "2"], label: "메모장" },
      { keys: ["⌘", "3"], label: "할 일" },
      { keys: ["⌘", "4"], label: "루틴" },
      { keys: ["⌘", "5"], label: "포트폴리오" },
    ],
  },
  {
    title: "메모 관리 (메모장 탭)",
    items: [
      { keys: ["⌘", "N"], label: "새 메모", note: "입력 중에도 동작" },
      { keys: ["⌘", "⌫"], label: "휴지통으로", note: "입력 밖에서만" },
      { keys: ["⌘", "↑"], label: "이전 메모", note: "입력 밖에서만" },
      { keys: ["⌘", "↓"], label: "다음 메모", note: "입력 밖에서만" },
    ],
  },
  {
    title: "메모 sub-tab",
    items: [
      { keys: ["⌥", "Tab"], label: "다음 sub-tab", note: "본문→음성기록→요약, 입력 안에서도" },
      { keys: ["⌥", "⇧", "Tab"], label: "이전 sub-tab" },
      { keys: ["⌘", "⇧", "E"], label: "편집/보기 토글", note: "본문 탭일 때만" },
    ],
  },
  {
    title: "편집",
    items: [
      { keys: ["⌘", "Z"], label: "되돌리기", note: "본문·메타 통합 timeline" },
      { keys: ["⌘", "⇧", "Z"], label: "다시 실행" },
      { keys: ["Esc"], label: "input 빠져나가기 / 변경 취소" },
    ],
  },
  {
    title: "본문 편집 (편집 모드)",
    items: [
      { keys: ["⌘", "B"], label: "굵게", note: "**text**" },
      { keys: ["⌘", "I"], label: "기울임", note: "*text*" },
      { keys: ["⌘", "E"], label: "인라인 코드", note: "`text`" },
      { keys: ["⌘", "⇧", "D"], label: "줄 복제" },
      { keys: ["⌘", "Enter"], label: "현재 줄 → 할 일 inbox", note: "체크박스 라인만" },
      { keys: ["⌥", "↑"], label: "줄 위로 이동" },
      { keys: ["⌥", "↓"], label: "줄 아래로 이동" },
      { keys: ["Tab"], label: "들여쓰기 (2-space)" },
      { keys: ["⇧", "Tab"], label: "내어쓰기" },
      { keys: ["Enter"], label: "리스트/인용 자동 연장", note: "빈 marker 에서 누르면 종료" },
      { keys: ["⇧", "Enter"], label: "리스트 연장 없이 줄바꿈", note: "빈 줄 여러 개 만들 때" },
    ],
  },
  {
    title: "일기 (캘린더)",
    items: [
      { keys: ["⌘", "Enter"], label: "저장하고 닫기" },
      { keys: ["⌘", "⇧", "E"], label: "편집/보기 토글", note: "내용 있을 때만" },
      { keys: ["Esc"], label: "닫기" },
    ],
  },
];

export function ShortcutsSection() {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <Text
            variant="caption"
            color="muted"
            as="h3"
            weight="semibold"
            className="mb-2 uppercase tracking-wide"
          >
            {group.title}
          </Text>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-6">
            {group.items.map((s) => (
              <li
                key={s.label}
                className="flex items-center gap-3 py-2"
                style={{ borderBottom: "1px solid var(--line)" }}
              >
                <div className="min-w-0 flex-1">
                  <Text variant="body" as="span">
                    {s.label}
                  </Text>
                  {s.note && (
                    <Text
                      variant="caption"
                      color="muted"
                      as="span"
                      className="ml-2"
                    >
                      {s.note}
                    </Text>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {s.keys.map((k, i) => (
                    <Kbd
                      key={i}
                      className="h-6 min-w-[1.5rem] px-1.5 text-xs"
                      style={{
                        backgroundColor: "var(--bg)",
                        color: "var(--sub)",
                      }}
                    >
                      {k}
                    </Kbd>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
