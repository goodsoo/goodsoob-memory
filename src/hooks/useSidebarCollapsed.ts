import { useCallback, useEffect, useState } from "react";

const KEY = "goodsoob:sidebarCollapsed";

function readKey(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  const key = KEY;
  const [collapsed, setCollapsed] = useState<boolean>(() => readKey(key));

  useEffect(() => {
    setCollapsed(readKey(key));
  }, [key]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, collapsed ? "1" : "0");
    } catch {
      // ignore — private mode / quota
    }
  }, [key, collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return { collapsed, toggle, setCollapsed };
}
