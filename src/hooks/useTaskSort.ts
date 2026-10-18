import { useEffect, useState } from "react";

export type TaskSortKey = "name" | "date_desc" | "date_asc" | "date_asc_undone";

// v3 bump: 기본 정렬을 오래된순→"오래된순(미완료 먼저)"로 바꾸면서 키를 갈아끼움.
// hook 이 mount 때 default 를 auto-persist 하던 탓에 옛 키엔 이전 값이 저장돼 있어,
// 키를 안 바꾸면 새 default 가 안 먹음. v3 는 저장값이 없어 새 default 적용.
const KEY = "goodsoob:todoSort3";

function readKey(key: string): TaskSortKey {
  // 할일 기본 정렬 = 오래된순(미완료 먼저). 안 끝낸 일이 위, 그 안에서 먼저 적은 것부터.
  if (typeof localStorage === "undefined") return "date_asc_undone";
  const v = localStorage.getItem(key);
  if (v === "date_desc") return "date_desc";
  if (v === "date_asc") return "date_asc";
  if (v === "date_asc_undone") return "date_asc_undone";
  if (v === "name") return "name";
  return "date_asc_undone";
}

export function useTaskSort() {
  const key = KEY;
  const [sortKey, setSortKey] = useState<TaskSortKey>(() => readKey(key));
  useEffect(() => {
    setSortKey(readKey(key));
  }, [key]);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, sortKey);
  }, [key, sortKey]);
  return [sortKey, setSortKey] as const;
}
