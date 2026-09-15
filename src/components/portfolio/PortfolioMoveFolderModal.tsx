import { useEffect, useState } from "react";
import { Folder, X } from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import {
  PORTFOLIO_DIR,
  folderPathOfCard,
  type PortfolioWorkMeta,
} from "../../api/portfolio";
import {
  useManualFolders,
  useMoveManualCard,
} from "../../hooks/usePortfolio";

type Props = {
  open: boolean;
  onClose: () => void;
  work: PortfolioWorkMeta;
};

// 수동 카드의 폴더 이동 — 메모장 MoveFolderModal 패턴 동형.
// 옵션: root (폴더 없음) + 모든 vault 수동 폴더. 현재 위치 비활성.
export function PortfolioMoveFolderModal({ open, onClose, work }: Props) {
  const foldersQuery = useManualFolders();
  const moveMutation = useMoveManualCard();
  const folders = foldersQuery.data ?? [];
  const currentFolder = folderPathOfCard(work.filePath);

  const [selected, setSelected] = useState<string>(currentFolder);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setSelected(currentFolder);
      setError(null);
    }
  }, [open, currentFolder]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canSubmit =
    selected !== currentFolder && !moveMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      await moveMutation.mutateAsync({
        fromPath: work.filePath,
        toFolder: selected,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      ariaLabelledBy="portfolio-move-title"
    >
      <div
        className="flex shrink-0 items-center gap-2 px-5 py-3"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <Folder
          className="h-4 w-4"
          style={{ color: "var(--sub)" }}
        />
        <Text
          id="portfolio-move-title"
          variant="body"
          weight="semibold"
          as="h2"
        >
          폴더로 이동
        </Text>
        <Button
          variant="icon"
          onClick={onClose}
          title="닫기  ESC"
          aria-label="닫기"
          className="ml-auto"
          style={{ color: "var(--faint)" }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
        <Text
          variant="caption"
          color="muted"
          as="p"
          className="mb-3 text-2xs leading-relaxed"
        >
          "{work.frontmatter.github_title}" 카드의 새 위치를 고르세요. 카드의
          첨부 스크린샷 (`{PORTFOLIO_DIR}/_attachments/`) 은 함께 이동하지
          않습니다.
        </Text>
        <ul className="flex flex-col gap-1">
          <FolderRow
            label="(폴더 없음)"
            path=""
            selected={selected}
            current={currentFolder}
            onSelect={setSelected}
          />
          {folders.map((f) => (
            <FolderRow
              key={f.path}
              label={f.path}
              path={f.path}
              selected={selected}
              current={currentFolder}
              onSelect={setSelected}
            />
          ))}
        </ul>

        {error ? (
          <Text
            variant="caption"
            as="p"
            className="mt-3"
            style={{ color: "var(--down-ink)" }}
          >
            {error}
          </Text>
        ) : null}
      </div>

      <div
        className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
        style={{ borderTop: "1px solid var(--line)" }}
      >
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="disabled:opacity-50"
        >
          {moveMutation.isPending ? "이동 중…" : "이동"}
        </Button>
      </div>
    </Modal>
  );
}

function FolderRow({
  label,
  path,
  selected,
  current,
  onSelect,
}: {
  label: string;
  path: string;
  selected: string;
  current: string;
  onSelect: (path: string) => void;
}) {
  const isSelected = selected === path;
  const isCurrent = current === path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(path)}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition"
        style={{
          backgroundColor: isSelected
            ? "var(--surface-3)"
            : "var(--surface)",
          border: "1px solid var(--line)",
          color: isCurrent ? "var(--faint)" : "var(--ink)",
        }}
      >
        <span className="flex items-center gap-2">
          <Folder
            className="h-3.5 w-3.5"
            style={{ color: "var(--faint)" }}
          />
          {label}
        </span>
        {isCurrent ? (
          <Text
            variant="caption"
            color="muted"
            as="span"
            className="text-3xs"
          >
            현재 위치
          </Text>
        ) : null}
      </button>
    </li>
  );
}
