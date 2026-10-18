import { useEffect, useState } from "react";

export type MeetingSortKey = "name" | "date_desc" | "date_asc";

const KEY = "goodsoob:meetingSort";

function readKey(key: string): MeetingSortKey {
  if (typeof localStorage === "undefined") return "date_desc";
  const v = localStorage.getItem(key);
  if (v === "date_desc" || v === "date_asc" || v === "name") return v;
  return "date_desc";
}

export function useMeetingSort() {
  const key = KEY;
  const [sortKey, setSortKey] = useState<MeetingSortKey>(() => readKey(key));
  useEffect(() => {
    setSortKey(readKey(key));
  }, [key]);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, sortKey);
  }, [key, sortKey]);
  return [sortKey, setSortKey] as const;
}
