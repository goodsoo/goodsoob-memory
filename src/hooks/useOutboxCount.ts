/**
 * useOutboxCount (T5) — 미sync outbox op 개수를 reactively 노출.
 *
 * design 실패모드 #1(iOS eviction → 유실)의 방어선: 사용자가 미sync 항목을 눈으로
 * 인지하고 flush 를 유도하게 한다. enqueue/flush 시 outbox 가 리스너를 호출 → 여기서 갱신.
 */

import { useEffect, useState } from "react";
import { subscribeOutbox } from "../lib/vault/outbox";

export function useOutboxCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // subscribeOutbox 는 구독 즉시 현재 count 를 push + 이후 변화마다 호출.
    const unsub = subscribeOutbox(setCount);
    return unsub;
  }, []);
  return count;
}
