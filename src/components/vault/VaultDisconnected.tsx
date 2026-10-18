import { useState } from "react";
import { useVault } from "../../lib/vault/useVault";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

export function VaultDisconnected() {
  const { reconnect } = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryReconnect() {
    setError(null);
    setBusy(true);
    try {
      await reconnect();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "여전히 vault 에 연결할 수 없어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-svh items-center justify-center px-6"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-full max-w-md rounded-xl p-6"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        <Text variant="h2" weight="bold" as="h1" className="mb-2">
          vault 에 연결할 수 없어요
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-5">
          로컬 서버가 실행 중인지 확인한 후 재연결해 주세요. iCloud 동기화 중이라면
          잠시 후 다시 시도하세요.
        </Text>

        <Button
          variant="danger"
          disabled={busy}
          onClick={tryReconnect}
          className="w-full rounded-lg px-4 py-2.5 transition-opacity"
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          {busy ? "재연결 중…" : "재연결"}
        </Button>

        {error && (
          <Text
            variant="body"
            as="div"
            className="mt-3 rounded px-3 py-2"
            style={{
              color: "var(--down)",
              background: "var(--bg)",
              border: "1px solid var(--down)",
            }}
          >
            {error}
          </Text>
        )}
      </div>
    </main>
  );
}
