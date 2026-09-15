import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVault } from "../../lib/vault/useVault";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

interface Props {
  from: string;
}

export function VaultDisconnected({ from }: Props) {
  const { reconnect, setVaultRoot } = useVault();
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
            : "여전히 vault 폴더에 접근할 수 없어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pickAnother() {
    setError(null);
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Vault 폴더 선택",
        defaultPath: from,
      });
      if (typeof result !== "string") return; // 취소 → disconnected 화면 유지
      setBusy(true);
      await setVaultRoot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          vault 폴더에 접근할 수 없어요
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-3">
          외장 디스크가 빠졌거나 iCloud 동기화가 꺼져있는지 확인한 후 재연결해
          주세요. 다른 폴더를 vault 로 쓰려면 [다른 폴더 선택] 을 누르세요.
        </Text>

        <Text
          variant="caption"
          color="secondary"
          as="div"
          className="mb-5 break-all rounded px-3 py-2"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line)",
          }}
        >
          이전 vault: <span className="font-mono">{from}</span>
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

        <Button
          variant="secondary"
          disabled={busy}
          onClick={pickAnother}
          className="mt-2 w-full rounded-lg px-4 py-2"
        >
          다른 폴더 선택
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
