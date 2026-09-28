import { useMemo } from "react";
import { formatAttendees, parseAttendees } from "../../lib/attendees";
import { NavItem, TagInput } from "@goodsoob/ds";
import { RemovableChip } from "../common/RemovableChip";

type Props = {
  value: string;
  onChange: (next: string) => void;
  suggestions: string[];
  placeholder?: string;
};

// 참석자 태그 입력. 칩행+draft+commit+backspace+IME 가드 상태머신은 DS TagInput
// 에 위임하고(한글 IME isComposing 가드도 DS 내부 소유 — TagInput.tsx:107),
// attendee 도메인 로직만 app-glue 로 유지: 문자열↔배열 파싱/포맷, 중복 case-fold,
// suggestion 소스·랭킹(prefix > substring). suggestion 표시는 TagInput 의
// render prop 으로 주입.
export function AttendeeTagInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: Props) {
  const tags = useMemo(() => parseAttendees(value), [value]);
  const tagsLower = useMemo(() => tags.map((t) => t.toLowerCase()), [tags]);

  // DS 는 raw 배열을 준다 — attendee 문자열로 포맷해 상위로 commit.
  function handleChange(nextTags: string[]) {
    // 중복(case-fold) 제거 + 콤마 제거. DS 는 값 의미를 모르니 여기서 정규화.
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of nextTags) {
      const t = raw.replace(/,/g, "").trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(t);
    }
    onChange(formatAttendees(cleaned));
  }

  // suggestion 랭킹 — 이미 담긴 태그 제외, prefix 먼저 그 다음 substring, 8개.
  function rankSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const candidates = suggestions.filter(
      (s) => !tagsLower.includes(s.toLowerCase()),
    );
    if (!q) return candidates.slice(0, 8);
    const startsWith = candidates.filter((s) => s.toLowerCase().startsWith(q));
    const contains = candidates.filter(
      (s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q),
    );
    return [...startsWith, ...contains].slice(0, 8);
  }

  return (
    <TagInput
      values={tags}
      onChange={handleChange}
      delimiters={["Enter", ","]}
      placeholder={placeholder ?? "이름 입력 후 Enter"}
      renderChip={(tagValue, i, remove) => (
        <RemovableChip
          key={`${tagValue}-${i}`}
          onRemove={remove}
          ariaLabel={`${tagValue} 제거`}
        >
          {tagValue}
        </RemovableChip>
      )}
      suggestions={({ query, commit, close }) => {
        const filtered = rankSuggestions(query);
        if (filtered.length === 0) return null;
        return (
          <ul
            className="max-h-48 overflow-auto rounded-lg shadow-md"
            style={{
              border: "1px solid var(--line)",
              backgroundColor: "var(--bg)",
            }}
            role="listbox"
          >
            {filtered.map((s) => (
              <li key={s}>
                <NavItem
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(s);
                    close();
                  }}
                  className="rounded-none px-3 py-1.5"
                  style={{ color: "var(--sub)" }}
                >
                  {s}
                </NavItem>
              </li>
            ))}
          </ul>
        );
      }}
    />
  );
}
