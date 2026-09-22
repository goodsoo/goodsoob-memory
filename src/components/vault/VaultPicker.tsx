import { useState } from "react";
import { Check } from "lucide-react";
import { useVault } from "../../lib/vault/useVault";
import { NavItem } from "@goodsoob/ds";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

interface Props {
  initialPath?: string | null;
  onCancel?: () => void;
}

export function VaultPicker({ initialPath = null, onCancel }: Props) {
  const { vaults, switchVault } = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function useExisting(id: string) {
    setError(null);
    setBusy(true);
    try {
      await switchVault(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasExisting = vaults.length > 0;

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
          Vault 연결
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-6">
          모든 메모/일기/할 일이 서버 vault 의 md 파일로 저장됩니다. 서버가 자동으로
          연결하며, 아래에서 기존 vault 를 선택할 수도 있어요.
        </Text>

        {hasExisting && (
          <section className="mb-5">
            <Text
              variant="caption"
              color="muted"
              as="h3"
              weight="semibold"
              className="mb-2 uppercase tracking-wide"
            >
              기존 vault 사용
            </Text>
            <ul
              className="rounded"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line-2)",
              }}
            >
              {vaults.map((v, i) => (
                <li
                  key={v.id}
                  style={{
                    borderTop:
                      i === 0 ? undefined : "1px solid var(--line-2)",
                  }}
                >
                  <NavItem
                    icon={<Check className="h-3.5 w-3.5" />}
                    onClick={busy ? undefined : () => useExisting(v.id)}
                    aria-disabled={busy}
                    title={v.path}
                    className="w-full aria-disabled:opacity-50 aria-disabled:pointer-events-none"
                  >
                    <div className="min-w-0 flex-1">
                      <Text
                        variant="body"
                        weight="medium"
                        as="div"
                        className="truncate"
                      >
                        {v.name}
                      </Text>
                      <Text
                        variant="caption"
                        color="muted"
                        as="div"
                        className="truncate"
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, monospace",
                        }}
                      >
                        {v.path}
                      </Text>
                    </div>
                  </NavItem>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!hasExisting && (
          <Text
            variant="caption"
            color="secondary"
            as="div"
            className="mb-4 rounded px-3 py-2"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
            }}
          >
            서버에 연결하는 중입니다. 잠시만 기다려 주세요.
            {initialPath && (
              <>
                {" "}
                (마지막 vault: <span className="font-mono">{initialPath}</span>)
              </>
            )}
          </Text>
        )}

        {onCancel && initialPath && (
          <Button
            variant="ghost"
            onClick={onCancel}
            className="mt-2 w-full px-4 py-2 font-normal"
            style={{ color: "var(--sub)" }}
          >
            취소
          </Button>
        )}

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
