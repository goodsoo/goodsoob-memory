import { useState } from "react";
import { Pencil, Trash2, Unlink } from "lucide-react";
import { useVault } from "../../lib/vault/useVault";
import { Radio } from "@goodsoob/ds";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Modal } from "../common/Modal";

type Props = {
  onAfterSwitch?: () => void;
};

export function VaultSection({ onAfterSwitch }: Props) {
  const {
    vaults,
    activeVaultId,
    activeVault,
    switchVault,
    removeVault,
    renameVault,
    disconnect,
  } = useVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  async function handleSwitch(id: string) {
    if (id === activeVaultId) return;
    setError(null);
    setBusy(true);
    try {
      await switchVault(id);
      onAfterSwitch?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startRename(id: string, current: string) {
    setRenamingId(id);
    setRenameDraft(current);
  }

  function commitRename() {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) renameVault(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  function handleRemove(id: string) {
    removeVault(id);
    setConfirmRemoveId(null);
  }

  const removingEntry = vaults.find((v) => v.id === confirmRemoveId) ?? null;

  function folderBasename(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  return (
    <div className="space-y-4">
      <section>
        <Text
          variant="caption"
          color="muted"
          as="h3"
          weight="semibold"
          className="mb-2 uppercase tracking-wide"
        >
          Vault 목록
        </Text>
        <ul
          className="rounded"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-2)",
          }}
        >
          {vaults.length === 0 && (
            <li className="px-3 py-3">
              <Text variant="caption" color="muted">
                연결된 vault 가 없습니다. 서버가 자동으로 연결합니다.
              </Text>
            </li>
          )}
          {vaults.map((v, i) => {
            const isActive = v.id === activeVaultId;
            const isRenaming = renamingId === v.id;
            return (
              <li
                key={v.id}
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  borderTop:
                    i === 0 ? undefined : "1px solid var(--line-2)",
                }}
              >
                <Radio
                  name="vault-selection"
                  value={v.id}
                  checked={isActive}
                  onChange={() => handleSwitch(v.id)}
                  disabled={busy}
                />
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") cancelRename();
                      }}
                      className="w-full rounded px-1.5 py-0.5 text-sm"
                      style={{
                        background: "var(--surface)",
                        color: "var(--ink)",
                        border: "1px solid var(--line)",
                      }}
                    />
                  ) : (
                    <div className="flex items-baseline gap-1.5 overflow-hidden">
                      <Text
                        variant="body"
                        weight="medium"
                        as="span"
                        className="truncate"
                      >
                        {v.name}
                      </Text>
                      {v.name !== folderBasename(v.path) && (
                        <Text
                          variant="caption"
                          color="muted"
                          as="span"
                          className="shrink-0 whitespace-nowrap"
                        >
                          (실제 폴더명: {folderBasename(v.path)})
                        </Text>
                      )}
                    </div>
                  )}
                  <Text
                    variant="caption"
                    color="muted"
                    as="div"
                    className="truncate"
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                  >
                    {v.path}
                  </Text>
                </div>
                {!isRenaming && (
                  <Button
                    variant="icon"
                    onClick={() => startRename(v.id, v.name)}
                    title="별칭 변경 (표시명만, 폴더는 그대로)"
                    aria-label="별칭 변경"
                    className="h-7 w-7"
                    style={{ color: "var(--sub)" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="icon"
                  onClick={() => setConfirmRemoveId(v.id)}
                  title="목록에서 제거"
                  aria-label="목록에서 제거"
                  className="h-7 w-7"
                  style={{ color: "var(--sub)" }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        {activeVault && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
              leftIcon={<Unlink className="h-4 w-4" />}
              className="rounded-lg px-3 py-2 active:opacity-80 disabled:opacity-50"
              style={{ background: "var(--bg)" }}
            >
              연결 해제
            </Button>
          </div>
        )}
        <Text variant="caption" color="muted" as="p">
          정렬·필터·사이드바 접힘은 vault 별로 따로 기억합니다.
        </Text>

        {error && (
          <Text
            variant="body"
            as="div"
            className="rounded px-3 py-2"
            style={{
              color: "var(--down)",
              background: "var(--bg)",
              border: "1px solid var(--down)",
            }}
          >
            {error}
          </Text>
        )}
      </section>

      {confirmDisconnect && (
        <DisconnectConfirmModal
          onConfirm={() => {
            setConfirmDisconnect(false);
            disconnect();
          }}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
      {removingEntry && (
        <RemoveVaultConfirmModal
          name={removingEntry.name}
          isActive={removingEntry.id === activeVaultId}
          onConfirm={() => handleRemove(removingEntry.id)}
          onCancel={() => setConfirmRemoveId(null)}
        />
      )}
    </div>
  );
}

function DisconnectConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open onClose={onCancel} size="md" ariaLabel="vault 연결 해제">
      <div className="p-5">
        <Text variant="body" weight="semibold" as="h3" className="mb-2">
          vault 연결 해제할까요?
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-4">
          vault 는 목록에 남아있고, 폴더 안 파일도 그대로예요. 다시 사용하려면
          헤더의 vault 드롭다운에서 선택하세요.
        </Text>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="px-3 py-1.5"
            style={{ color: "var(--sub)" }}
          >
            취소
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            className="px-3 py-1.5"
          >
            해제
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RemoveVaultConfirmModal({
  name,
  isActive,
  onConfirm,
  onCancel,
}: {
  name: string;
  isActive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open onClose={onCancel} size="md" ariaLabel="vault 제거">
      <div className="p-5">
        <Text variant="body" weight="semibold" as="h3" className="mb-2">
          "{name}" 을 목록에서 제거할까요?
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-4">
          폴더 안 파일은 그대로 남아있어요 (디스크에서 삭제 X). 나중에 "새 vault
          추가" 로 다시 등록할 수 있습니다.
          {isActive && " 활성 vault 였다면 연결도 함께 해제됩니다."}
        </Text>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="px-3 py-1.5"
            style={{ color: "var(--sub)" }}
          >
            취소
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            className="px-3 py-1.5"
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            제거
          </Button>
        </div>
      </div>
    </Modal>
  );
}

