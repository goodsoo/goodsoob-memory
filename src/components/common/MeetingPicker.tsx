import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useMeetings } from "../../hooks/useMeetings";
import { formatDateShortWithDay } from "../../lib/dates";
import { Button } from "./Button";
import { NavItem } from "../../ds/NavItem";
import { Text } from "./Text";
import { Popover } from "./Popover";

type Props = {
  value: string | null; // selected meeting uid
  onChange: (uid: string | null) => void;
};

// 메모가 많아지면 select dropdown 에서 찾기 어려움 → 검색 가능한 popover.
// 옵시디안 quick switcher 같은 느낌. 외부 클릭 / ESC 로 닫힘.
export function MeetingPicker({ value, onChange }: Props) {
  const meetingsQ = useMeetings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value
    ? meetingsQ.data?.find((m) => m.uid === value) ?? null
    : null;
  const buttonLabel = selected
    ? selected.title?.trim() || "(제목 없음)"
    : "연결 없음";

  const filtered = useMemo(() => {
    const all = meetingsQ.data ?? [];
    const q = query.trim().toLowerCase();
    // 최신순 — date desc (null last) → mtime desc fallback.
    const sorted = all.slice().sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      return b.mtime - a.mtime;
    });
    if (!q) return sorted.slice(0, 30);
    return sorted
      .filter((m) => (m.title?.trim() || "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [meetingsQ.data, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="relative inline-flex items-center"
      panelClassName="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md shadow-md"
      panelStyle={{
        backgroundColor: "var(--bg)",
        border: "1px solid var(--line)",
      }}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="max-w-[12rem] px-2 py-0.5 font-normal"
          style={{ color: "var(--sub)" }}
          aria-haspopup="listbox"
          aria-expanded={open}
          leftIcon={
            <FileText className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          }
        >
          <span className="truncate">{buttonLabel}</span>
        </Button>
      }
    >
      <div onClick={(e) => e.stopPropagation()}>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5"
            style={{ borderBottom: "1px solid var(--line-2)" }}
          >
            <Search
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--faint)" }}
              aria-hidden
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="메모 검색"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              style={{ color: "var(--ink)" }}
            />
            {value ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="shrink-0 px-1.5 py-0.5 text-2xs font-normal"
                style={{ color: "var(--faint)" }}
              >
                연결 해제
              </Button>
            ) : null}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <Text
                variant="caption"
                color="muted"
                as="li"
                className="px-3 py-2 text-center"
              >
                일치하는 메모 없음
              </Text>
            ) : (
              filtered.map((m) => {
                const active = m.uid === value;
                return (
                  <li key={m.uid}>
                    <NavItem
                      active={active}
                      onClick={() => {
                        onChange(m.uid);
                        setOpen(false);
                      }}
                      className="rounded-none px-3 py-1.5"
                      style={{
                        backgroundColor: active
                          ? "var(--surface-3)"
                          : undefined,
                        color: active
                          ? "var(--ink)"
                          : "var(--sub)",
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {m.title?.trim() || "(제목 없음)"}
                      </span>
                      {m.date ? (
                        <Text
                          variant="caption"
                          color="muted"
                          as="span"
                          className="shrink-0 font-mono text-3xs"
                        >
                          {formatDateShortWithDay(m.date)}
                        </Text>
                      ) : null}
                    </NavItem>
                  </li>
                );
              })
            )}
          </ul>
      </div>
    </Popover>
  );
}
