import type { ReactNode } from "react";
import { useVault } from "../../lib/vault/useVault";
import { VaultDisconnected } from "./VaultDisconnected";

export function VaultGate({ children }: { children: ReactNode }) {
  const { vaultRoot, isReady, disconnected } = useVault();

  if (disconnected) {
    return <VaultDisconnected />;
  }
  if (!vaultRoot || !isReady) {
    // 서버 vault 연결 + 초기화 중 — 잠깐 스피너.
    return (
      <main className="flex min-h-svh items-center justify-center">
        <div
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2"
          style={{
            borderColor: "var(--line)",
            borderTopColor: "var(--down)",
          }}
        />
        <span className="sr-only">vault 연결 중</span>
      </main>
    );
  }
  return <>{children}</>;
}
