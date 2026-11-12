import { Sun, FileText, CheckSquare, Mic, Repeat, LayoutGrid, BookOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tab = "today" | "meetings" | "todos" | "recordings" | "routines" | "portfolio" | "notebook";

// 탭 메타데이터 — HeaderTabs / SidePanel / 단축키 분기에서 공유하는 단일 source.
// 순서 = 사용 빈도 + Cmd+1.. 의미 (App.tsx 단축키가 TABS index 기반).
// "오늘" 이 기본 진입 (SIMPLIFY: 매일 처음 보는 화면). 캘린더 탭은 폐기 —
// 날짜 훑기·일기 진입은 "오늘" 탭 사이드바(세로 날짜 리스트)가 흡수.
export const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "today", label: "오늘", icon: Sun },
  { id: "meetings", label: "메모장", icon: FileText },
  // 녹음 = 처리할 녹음 인박스 (docs/designs/recording-tab.md), Cmd+3.
  // 할 일/루틴은 추후 제거 예정 — 앞 4개(오늘/메모장/녹음/포트폴리오) 단축키가 고정되도록 뒤로.
  { id: "recordings", label: "녹음", icon: Mic },
  { id: "portfolio", label: "포트폴리오", icon: LayoutGrid },
  // 노트북 = 자료에 묶인 소화물(브리핑 · 퀴즈) 뷰어 (docs/designs/notebook-tab.md), Cmd+5.
  { id: "notebook", label: "노트북", icon: BookOpen },
  { id: "todos", label: "할 일", icon: CheckSquare },
  { id: "routines", label: "루틴", icon: Repeat },
];
