import { Sun, FileText, CheckSquare, Repeat, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tab = "today" | "meetings" | "todos" | "routines" | "portfolio";

// 탭 메타데이터 — HeaderTabs / SidePanel / 단축키 분기에서 공유하는 단일 source.
// 순서 = 사용 빈도 + Cmd+1.. 의미 (App.tsx 단축키가 TABS index 기반).
// "오늘" 이 기본 진입 (SIMPLIFY: 매일 처음 보는 화면). 캘린더 탭은 폐기 —
// 날짜 훑기·일기 진입은 "오늘" 탭 사이드바(세로 날짜 리스트)가 흡수.
export const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "today", label: "오늘", icon: Sun },
  { id: "meetings", label: "메모장", icon: FileText },
  { id: "todos", label: "할 일", icon: CheckSquare },
  // 루틴·포트폴리오는 "가끔" 쓰는 2군 — 매일 쓰는 오늘/메모장/할 일 뒤에 둠.
  { id: "routines", label: "루틴", icon: Repeat },
  { id: "portfolio", label: "포트폴리오", icon: LayoutGrid },
];
