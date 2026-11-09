import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ListGroup, ListRow } from "@goodsoob/ds";
import type { ReviewItem } from "../../api/recordings";

type Props = {
  items: readonly ReviewItem[];
  /** "그대로 두기" — 이 후보를 고치지 않고 넘긴다 (kept 결정). */
  onKeep: (id: number) => void;
  disabled?: boolean;
};

/** 본문에서 위치를 못 찾은 고칠 곳 — 접힌 한 행, 누르면 항목별 "그대로 두기" 행이 펼쳐진다. */
export function UnmatchedCandidates({ items, onKeep, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="pt-6" data-testid="unmatched-candidates">
      <ListGroup>
        <ListRow
          label="본문에서 위치를 못 찾은 고칠 곳"
          value={
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              {items.length}개
              <Chevron className="h-4 w-4" aria-hidden />
            </span>
          }
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
        {open
          ? items.map((it) => (
              <ListRow
                key={it.id}
                label={
                  <span className="min-w-0">
                    <span style={{ color: "var(--sub)" }}>{it.orig || "(내용 없음)"}</span>
                    {it.sugg ? <span> → {it.sugg}</span> : null}
                  </span>
                }
                value="그대로 두기"
                title="이 항목을 고치지 않고 넘깁니다"
                disabled={disabled}
                onClick={() => onKeep(it.id)}
              />
            ))
          : null}
      </ListGroup>
    </div>
  );
}
