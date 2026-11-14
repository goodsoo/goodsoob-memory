import { FileText, Mic, LayoutGrid, BookOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tab = "meetings" | "recordings" | "portfolio" | "notebook";

// 탭 메타데이터 — HeaderTabs / SidePanel / 단축키 분기에서 공유하는 단일 source.
// 순서 = 사용 빈도 + Cmd+1.. 의미 (App.tsx 단축키가 TABS index 기반).
// 메모장이 기본 진입. 오늘 · 할 일 · 루틴 탭은 은퇴 (feat/retire-tabs).
export const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "meetings", label: "메모장", icon: FileText },
  // 녹음 = 처리할 녹음 인박스 (docs/designs/recording-tab.md).
  { id: "recordings", label: "녹음", icon: Mic },
  { id: "portfolio", label: "포트폴리오", icon: LayoutGrid },
  // 노트북 = 자료에 묶인 소화물(브리핑 · 퀴즈) 뷰어 (docs/designs/notebook-tab.md).
  { id: "notebook", label: "노트북", icon: BookOpen },
];
