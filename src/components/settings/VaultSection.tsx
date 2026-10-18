import { useVault } from "../../lib/vault/useVault";
import { Text } from "../common/Text";

// vault 는 서버가 소유한 단일 VAULT_DIR 로 고정 — 선택·전환 UI 없음.
// 저장 위치만 읽기 전용으로 보여준다.
export function VaultSection() {
  const { vaultRoot } = useVault();

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
          저장 위치
        </Text>
        <div
          className="break-all rounded px-3 py-2"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-2)",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          <Text variant="caption" color={vaultRoot ? "secondary" : "muted"} as="span">
            {vaultRoot ?? "서버에 연결하는 중입니다."}
          </Text>
        </div>
      </section>

      <Text variant="caption" color="muted" as="p">
        모든 메모, 일기, 할 일, 포트폴리오가 이 폴더의 마크다운 파일로 저장됩니다.
        저장 위치는 서버 설정으로 고정됩니다.
      </Text>
    </div>
  );
}
