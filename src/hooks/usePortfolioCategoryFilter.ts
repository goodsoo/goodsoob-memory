import { useCallback, useEffect, useState } from "react";

// 작업 카드 카테고리 chip 필터. single radio. "all" = 전체 (필터 X).
// 할 일 카테고리 필터와 동일한 정신 모델 — 한 번에 하나만 본다.
// localStorage 에 직렬화. 옛 multi (string[]) 도 lazy 흡수 — 첫 값만 채용.
// 카테고리는 builtin 5 + categories.md user-defined 라 enum check 없이 string 그대로
// 받음. 매칭 안 되는 slug 가 들어와도 UI 가 chip row 에서 안 보일 뿐 (위험 0).
const KEY = "goodsoob:portfolioCategoryFilter";

export type PortfolioCategoryFilter = "all" | string;

function readKey(key: string): PortfolioCategoryFilter {
  if (typeof localStorage === "undefined") return "all";
  const raw = localStorage.getItem(key);
  if (!raw) return "all";
  try {
    const parsed = JSON.parse(raw);
    // 옛 multi 형식 (string[]) — 첫 값만 single 로 흡수, 비어있으면 "all".
    if (Array.isArray(parsed)) {
      const first = parsed.find(
        (v) => typeof v === "string" && v.length > 0,
      );
      return (first as string | undefined) ?? "all";
    }
    if (parsed === "all") return "all";
    if (typeof parsed === "string" && parsed.length > 0) return parsed;
    return "all";
  } catch {
    return "all";
  }
}

export function usePortfolioCategoryFilter() {
  const key = KEY;
  const [selected, setSelected] = useState<PortfolioCategoryFilter>(() =>
    readKey(key),
  );

  useEffect(() => {
    setSelected(readKey(key));
  }, [key]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(selected));
  }, [key, selected]);

  const change = useCallback((next: PortfolioCategoryFilter) => {
    setSelected(next);
  }, []);

  return { selected, change } as const;
}
