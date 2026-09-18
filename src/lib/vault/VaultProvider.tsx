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
import {
  addVault as registryAddVault,
  getActiveVaultId,
  getVaults,
  removeVault as registryRemoveVault,
  renameVault as registryRenameVault,
  setActiveVaultId,
  type VaultEntry,
} from "./registry";
import { isTauri } from "../isTauri";

interface VaultContextValue {
  adapter: VaultAdapter;
  watcher: VaultWatcher;
  vaults: VaultEntry[];
  activeVaultId: string | null;
  activeVault: VaultEntry | null;
  /** activeVault?.path ?? null — 단일 vault 시절 코드 호환용. */
  vaultRoot: string | null;
  /** path 로 새 vault 추가 + 활성화. 기존 path 면 그 entry 재활성화. */
  setVaultRoot: (path: string, name?: string) => Promise<void>;
  switchVault: (id: string) => Promise<void>;
  addVault: (name: string, path: string) => Promise<VaultEntry>;
  removeVault: (id: string) => void;
  renameVault: (id: string, name: string) => void;
  /** 활성 해제 (list 는 보존). 다시 클릭하면 재연결. */
  disconnect: () => void;
  isReady: boolean;
  /** 접근 불가로 끊긴 vault path. 명시 disconnect 일 땐 null. */
  disconnectedFrom: string | null;
  reconnect: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const VaultContext = createContext<VaultContextValue | null>(null);
export type { VaultContextValue };

export function VaultProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [adapter] = useState<VaultAdapter>(() => selectAdapter());
  const [watcher] = useState<VaultWatcher>(() =>
    createVaultWatcher(adapter, queryClient),
  );

  const [vaults, setVaultsState] = useState<VaultEntry[]>(() => getVaults());
  const [activeVaultId, setActiveVaultIdState] = useState<string | null>(() =>
    getActiveVaultId(),
  );
  const [isReady, setIsReady] = useState(false);
  const [disconnectedFrom, setDisconnectedFrom] = useState<string | null>(null);

  const activeVault = useMemo(
    () => vaults.find((v) => v.id === activeVaultId) ?? null,
    [vaults, activeVaultId],
  );
  const vaultRoot = activeVault?.path ?? null;

  const refreshVaults = useCallback(() => {
    setVaultsState(getVaults());
  }, []);

  const setVaultRoot = useCallback(
    async (path: string, name?: string) => {
      const entry = registryAddVault(name ?? "", path);
      refreshVaults();
      setActiveVaultId(entry.id);
      setActiveVaultIdState(entry.id);
      // 실제 watcher / adapter 셋업은 activeVaultId 변경 useEffect 가 담당.
      // 다만 setVaultRoot caller (VaultPicker / Settings) 는 await 으로 "준비됨"
      // 상태를 기대하므로 여기서 동기적으로 root 가 디스크에 실재하는지 확인.
      adapter.setRoot(path);
      if (!(await adapter.exists(""))) {
        // path missing → vault 자체는 list 에 남기되 활성 해제 + disconnected 분기.
        setActiveVaultId(null);
        setActiveVaultIdState(null);
        setDisconnectedFrom(path);
        throw new Error(
          "폴더에 접근할 수 없어요. 외장 디스크 / iCloud 연결을 확인하세요.",
        );
      }
      setDisconnectedFrom(null);
    },
    [adapter, refreshVaults],
  );

  const switchVault = useCallback(
    async (id: string) => {
      const next = getVaults().find((v) => v.id === id);
      if (!next) return;
      if (id === activeVaultId) return;
      setActiveVaultId(id);
      setActiveVaultIdState(id);
      setDisconnectedFrom(null);
      // 사이드패널이 옛 vault 의 선택 meeting uid 를 들고 있으면 빈 detail 로 깜빡임 — hash 비움.
      if (window.location.hash.startsWith("#meeting-")) {
        window.location.hash = "#meetings";
      }
    },
    [activeVaultId],
  );

  const addVault = useCallback(
    async (name: string, path: string): Promise<VaultEntry> => {
      const entry = registryAddVault(name, path);
      refreshVaults();
      return entry;
    },
    [refreshVaults],
  );

  const removeVault = useCallback(
    (id: string) => {
      registryRemoveVault(id);
      refreshVaults();
      if (id === activeVaultId) {
        setActiveVaultIdState(null);
      }
    },
    [activeVaultId, refreshVaults],
  );

  const renameVault = useCallback(
    (id: string, name: string) => {
      registryRenameVault(id, name);
      refreshVaults();
    },
    [refreshVaults],
  );

  const disconnect = useCallback(() => {
    setActiveVaultId(null);
    setActiveVaultIdState(null);
    setDisconnectedFrom(null);
    // watcher / queryClient.clear 는 activeVaultId useEffect cleanup 에서.
  }, []);

  const reconnect = useCallback(async () => {
    if (!disconnectedFrom) return;
    await setVaultRoot(disconnectedFrom);
  }, [disconnectedFrom, setVaultRoot]);

  // 브라우저(웹앱) 모드 — 마운트 1회: 서버가 소유한 vault 를 자동 등록·활성화.
  // Tauri 이거나 이미 활성 vault 가 있으면 즉시 return (데스크탑·재방문 무손상).
  useEffect(() => {
    if (isTauri) return;
    if (activeVaultId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vault/init");
        if (!res.ok || cancelled) return;
        const { vaultPath } = (await res.json()) as { vaultPath?: string };
        if (!vaultPath || cancelled) return;
        await setVaultRoot(vaultPath);
      } catch {
        // fetch 실패 → 폴더 선택 화면으로 자연 폴백
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 마운트 1회만 — activeVaultId/setVaultRoot 의존성 의도적으로 제외

  // activeVaultId 변화에 반응해서 watcher 재시작 + queryClient 초기화.
  useEffect(() => {
    if (!vaultRoot) {
      setIsReady(false);
      watcher.stop();
      queryClient.clear();
      return;
    }
    let cancelled = false;
    let aliveTimer: ReturnType<typeof setInterval> | null = null;

    function handleVaultGone() {
      if (cancelled) return;
      cancelled = true;
      watcher.stop();
      if (aliveTimer) clearInterval(aliveTimer);
      window.removeEventListener("focus", checkAlive);
      queryClient.clear();
      setDisconnectedFrom(vaultRoot);
      setActiveVaultId(null);
      setActiveVaultIdState(null);
    }

    async function checkAlive() {
      if (cancelled) return;
      try {
        const ok = await adapter.exists("");
        if (!ok) handleVaultGone();
      } catch {
        handleVaultGone();
      }
    }

    (async () => {
      adapter.setRoot(vaultRoot);
      // 전환 시 옛 vault 의 React Query cache 가 잠깐 보이는 거 차단.
      queryClient.clear();
      try {
        await ensureVaultStructure(adapter);
        if (cancelled) return;
        await watcher.start();
        setIsReady(true);
        aliveTimer = setInterval(checkAlive, 3000);
        window.addEventListener("focus", checkAlive);
      } catch (err) {
        console.error("vault init failed", err);
        if (cancelled) return;
        setDisconnectedFrom(vaultRoot);
        setActiveVaultId(null);
        setActiveVaultIdState(null);
        setIsReady(false);
      }
    })();
    return () => {
      cancelled = true;
      watcher.stop();
      if (aliveTimer) clearInterval(aliveTimer);
      window.removeEventListener("focus", checkAlive);
    };
  }, [vaultRoot, adapter, watcher, queryClient]);

  const value = useMemo<VaultContextValue>(
    () => ({
      adapter,
      watcher,
      vaults,
      activeVaultId,
      activeVault,
      vaultRoot,
      setVaultRoot,
      switchVault,
      addVault,
      removeVault,
      renameVault,
      disconnect,
      isReady,
      disconnectedFrom,
      reconnect,
    }),
    [
      adapter,
      watcher,
      vaults,
      activeVaultId,
      activeVault,
      vaultRoot,
      setVaultRoot,
      switchVault,
      addVault,
      removeVault,
      renameVault,
      disconnect,
      isReady,
      disconnectedFrom,
      reconnect,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
