import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderPlus } from "lucide-react";
import { useVault } from "../../lib/vault/useVault";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

interface Props {
  initialPath?: string | null;
  onCancel?: () => void;
}

export function VaultPicker({ initialPath = null, onCancel }: Props) {
  const { setVaultRoot, vaults, switchVault } = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Vault 폴더 선택",
        defaultPath: initialPath ?? undefined,
      });
      if (typeof result !== "string") return; // 취소
      setBusy(true);
      await setVaultRoot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
          Vault 폴더 선택
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-6">
          모든 메모/일기/할 일이 이 폴더 안의 md 파일로 저장됩니다. iCloud Drive 같은
          동기화 폴더 안에 두면 다른 기기에서도 같은 vault를 공유할 수 있어요.
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
                  <button
                    type="button"
                    onClick={() => useExisting(v.id)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)] disabled:opacity-50"
                    title={v.path}
                  >
                    <Check
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: "var(--sub)" }}
                    />
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
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {initialPath && !hasExisting && (
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
            현재: <span className="font-mono">{initialPath}</span>
          </Text>
        )}

        <Button
          variant="danger"
          disabled={busy}
          onClick={pick}
          leftIcon={<FolderPlus className="h-4 w-4" />}
          className="w-full rounded-lg px-4 py-2.5 transition-opacity"
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          {busy
            ? "준비 중…"
            : hasExisting
              ? "새 vault 폴더 추가"
              : initialPath
                ? "다른 폴더로 변경"
                : "폴더 선택하기"}
        </Button>

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
