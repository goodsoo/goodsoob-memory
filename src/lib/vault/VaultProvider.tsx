import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VaultAdapter } from "./adapter";
import { selectAdapter } from "./selectAdapter";
import { createVaultWatcher, type VaultWatcher } from "./watcher";
import { ensureVaultStructure } from "./scan";

interface VaultContextValue {
  adapter: VaultAdapter;
  watcher: VaultWatcher;
  /** 서버가 소유한 단일 vault(VAULT_DIR) 의 절대경로. 초기화 전/접근 불가 시 null. */
  vaultRoot: string | null;
  isReady: boolean;
  /** 서버/폴더 접근 불가로 끊긴 상태. 재연결 성공 전까지 true. */
  disconnected: boolean;
  reconnect: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const VaultContext = createContext<VaultContextValue | null>(null);
export type { VaultContextValue };

// vault 는 서버가 소유한 단일 VAULT_DIR 하나로 고정. 클라이언트는 /api/vault/init 로
// 그 경로를 받아 adapter 에 연결만 한다 — 선택·추가·전환 개념 없음.
//
// 연결 모델: 최초 1회 연결에 성공하면 그 뒤로는 끊김 판정을 하지 않는다. 서버가
// 잠깐 깜빡여도(auto-commit git lock·fsWatch churn·iCloud 지연·탭 복귀) 읽기는
// offlineAdapter 의 IndexedDB 캐시가 흡수하고, 쓰기는 outbox 가 큐잉한다. 옛 3초
// 주기 exists 폴링은 이 일시 깜빡임을 "폴더 소실"로 오판해 멀쩡한 화면을 덮던
// 과민 판정이라 제거했다(자매 앱 growth 와 동일한 캐시 폴백 모델). disconnected 는
// "최초 연결·초기화 실패"(= 보여줄 데이터가 아예 없음) 에서만 true.
export function VaultProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [adapter] = useState<VaultAdapter>(() => selectAdapter());
  const [watcher] = useState<VaultWatcher>(() =>
    createVaultWatcher(adapter, queryClient),
  );

  const [vaultRoot, setVaultRootState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  // 서버가 소유한 VAULT_DIR 를 받아 adapter 에 연결. 폴더 실재 확인까지.
  // 성공 시 disconnected=false + vaultRoot 세팅 → watcher useEffect 가 활성화.
  const connect = useCallback(async () => {
    const res = await fetch("/api/vault/init");
    if (!res.ok) throw new Error("서버에 연결할 수 없어요.");
    const { vaultPath } = (await res.json()) as { vaultPath?: string };
    if (!vaultPath) throw new Error("서버가 vault 경로를 반환하지 않았어요.");
    adapter.setRoot(vaultPath);
    if (!(await adapter.exists(""))) {
      throw new Error("vault 폴더에 접근할 수 없어요.");
    }
    setDisconnected(false);
    setVaultRootState(vaultPath);
  }, [adapter]);

  const reconnect = useCallback(async () => {
    try {
      await connect();
    } catch (err) {
      setDisconnected(true);
      throw err; // VaultDisconnected 가 메시지로 표시
    }
  }, [connect]);

  // 마운트 1회: 서버 vault 자동 연결. 실패하면 disconnected 화면으로.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await connect();
      } catch {
        if (!cancelled) setDisconnected(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 마운트 1회만 — connect 의존성 의도적으로 제외

  // vaultRoot 활성화에 반응해서 watcher 시작. (상시 폴링 없음 — 위 주석 참조.)
  useEffect(() => {
    if (!vaultRoot) {
      setIsReady(false);
      watcher.stop();
      queryClient.clear();
      return;
    }
    let cancelled = false;

    (async () => {
      adapter.setRoot(vaultRoot);
      queryClient.clear();
      try {
        await ensureVaultStructure(adapter);
        if (cancelled) return;
        await watcher.start();
        setIsReady(true);
      } catch (err) {
        console.error("vault init failed", err);
        if (cancelled) return;
        // 최초 초기화 실패만 끊김 처리 — 일단 ready 가 된 뒤엔 여기 안 온다.
        // 운영 중 서버 깜빡임은 offlineAdapter 읽기 캐시 / outbox 가 흡수.
        setDisconnected(true);
        setVaultRootState(null);
        setIsReady(false);
      }
    })();
    return () => {
      cancelled = true;
      watcher.stop();
    };
  }, [vaultRoot, adapter, watcher, queryClient]);

  const value = useMemo<VaultContextValue>(
    () => ({
      adapter,
      watcher,
      vaultRoot,
      isReady,
      disconnected,
      reconnect,
    }),
    [adapter, watcher, vaultRoot, isReady, disconnected, reconnect],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
