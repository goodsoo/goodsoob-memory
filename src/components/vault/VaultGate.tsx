import type { ReactNode } from "react";
import { useVault } from "../../lib/vault/useVault";
import { VaultDisconnected } from "./VaultDisconnected";
import { VaultPicker } from "./VaultPicker";

export function VaultGate({ children }: { children: ReactNode }) {
  const { vaultRoot, isReady, disconnectedFrom } = useVault();

  if (!vaultRoot) {
    if (disconnectedFrom) {
      return <VaultDisconnected from={disconnectedFrom} />;
    }
    return <VaultPicker />;
  }
  if (!isReady) {
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
        <span className="sr-only">vault 로딩 중</span>
      </main>
    );
  }
  return <>{children}</>;
}
