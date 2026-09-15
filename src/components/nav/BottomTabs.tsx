import { Sun, FileText, CheckSquare, Repeat, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tab = "today" | "meetings" | "todos" | "routines" | "portfolio";

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

// SidePanel / ActivityBar / 단축키 분기에서 공유. 함수/상수도 같은 파일에서 export.
// 순서 = 사용 빈도 + Cmd+1.. 의미 (App.tsx 단축키가 TABS index 기반).
// "오늘" 이 기본 진입 (SIMPLIFY: 매일 처음 보는 화면). 캘린더 탭은 폐기 —
// 날짜 훑기·일기 진입은 "오늘" 탭 사이드바(세로 날짜 리스트)가 흡수.
// eslint-disable-next-line react-refresh/only-export-components
export const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "today", label: "오늘", icon: Sun },
  { id: "meetings", label: "메모장", icon: FileText },
  { id: "todos", label: "할 일", icon: CheckSquare },
  // 루틴·포트폴리오는 "가끔" 쓰는 2군 — 매일 쓰는 오늘/메모장/할 일 뒤에 둠.
  { id: "routines", label: "루틴", icon: Repeat },
  { id: "portfolio", label: "포트폴리오", icon: LayoutGrid },
];

export function BottomTabs({ activeTab, onTabChange }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 backdrop-blur lg:hidden"
      style={{
        paddingBottom: "var(--safe-bottom)",
        backgroundColor: "var(--bg-overlay)",
        borderTop: "1px solid var(--line)",
      }}
      aria-label="primary"
    >
      <div className="mx-auto flex w-full max-w-2xl">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              aria-current={active ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-3xs transition"
              style={{ color: active ? "var(--ink)" : "var(--faint)" }}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
              <span className={active ? "font-medium" : ""}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
