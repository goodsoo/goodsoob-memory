import { useEffect, useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { LooseDateInput } from "../common/LooseDateInput";
import { CategoryCombobox } from "./CategoryCombobox";
import {
  useCreateManualPortfolioWork,
  useManualFolders,
} from "../../hooks/usePortfolio";

type Props = {
  open: boolean;
  onClose: () => void;
};

// PR 무관 수동 카드 생성 — 오프라인 업무 / 회의 발표 / 외부 협업 등. 새 카테고리는
// 본문 chip row, 새 폴더는 사이드바 헤더에서 만들고, 모달 안 select 는 기존 항목 중
// 고르기만. TaskAddModal 패턴 통일.
export function PortfolioCreateModal({ open, onClose }: Props) {
  const create = useCreateManualPortfolioWork();
  const foldersQuery = useManualFolders();
  const folders = foldersQuery.data ?? [];

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("other");
  const [impact, setImpact] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDate(new Date().toISOString().slice(0, 10));
    setCategory("other");
    setImpact("");
    setFolder("");
    setError(null);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const titleTrimmed = title.trim();
  const canSubmit = titleTrimmed.length > 0 && !create.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await create.mutateAsync({
        title: titleTrimmed,
        date,
        category,
        impact_summary: impact.trim(),
        folder,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      ariaLabelledBy="portfolio-create-title"
    >
      <form className="flex flex-col p-5" onSubmit={handleSubmit}>
        <Text id="portfolio-create-title" variant="h4" as="h2">
          새 카드
        </Text>
        <Text
          variant="caption"
          color="muted"
          as="p"
          className="mt-1 text-[11px] leading-relaxed"
        >
          PR 없이 카드를 추가합니다. 새 카테고리는 카테고리 입력란에서 바로
          만들고, 새 폴더는 사이드바에서 만듭니다.
        </Text>

        <label className="mt-4 block">
          <Text variant="caption" color="secondary" as="span" weight="medium">
            제목 <span style={{ color: "var(--down)" }}>*</span>
          </Text>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하세요"
            aria-required="true"
            autoFocus
            maxLength={200}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          />
        </label>

        <label className="mt-3 block">
          <Text variant="caption" color="secondary" as="span" weight="medium">
            한 줄 임팩트
          </Text>
          <input
            type="text"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            placeholder="한 줄 임팩트를 입력하세요"
            maxLength={120}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-sm outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          />
        </label>

        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: "2fr 1fr" }}
        >
          <label className="block">
            <Text variant="caption" color="secondary" as="span" weight="medium">
              날짜
            </Text>
            <div
              className="mt-1 rounded-md px-2 py-1.5"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--line)",
              }}
            >
              <LooseDateInput value={date} onCommit={setDate} fullWidth />
            </div>
          </label>
          <div className="block">
            <Text variant="caption" color="secondary" as="span" weight="medium">
              카테고리
            </Text>
            <div className="mt-1">
              <CategoryCombobox value={category} onChange={setCategory} />
            </div>
          </div>
        </div>

        <label className="mt-3 block">
          <Text variant="caption" color="secondary" as="span" weight="medium">
            폴더
          </Text>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          >
            <option value="">(폴더 없음)</option>
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </label>

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

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} type="button">
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
            className="disabled:opacity-50"
          >
            {create.isPending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
