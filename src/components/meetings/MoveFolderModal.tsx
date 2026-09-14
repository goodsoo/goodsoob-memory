import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderRoot, Plus, X } from "lucide-react";
import {
  buildMeetingsTree,
  flattenFolderPaths,
} from "../../lib/meetingsTree";
import { useMeetingFolders, useMeetings } from "../../hooks/useMeetings";
import { meetingFolder } from "../../api/meetings";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";

type Props = {
  open: boolean;
  meetingId: string | null; // 현재 메모의 file path. null 이면 모달 자체가 비활성.
  meetingTitle: string;
  onClose: () => void;
  onMove: (folder: string) => Promise<void>;
};

// 메모 폴더 이동 picker. 기존 폴더 list (root 포함) + 새 폴더 만들기 input.
// 빌더 모드 단순화 — 깊이/계층 미리보기보다 path 그대로 보여줌 ("work/2026").
export function MoveFolderModal({
  open,
  meetingId,
  meetingTitle,
  onClose,
  onMove,
}: Props) {
  const { data: meetings } = useMeetings();
  const { data: emptyFolders } = useMeetingFolders();
  const currentFolder = meetingId ? meetingFolder(meetingId) : "";
  const [newFolderInput, setNewFolderInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 기존 폴더 list — 트리 평면화. 빈 폴더 (메모 0개) 도 picker 에 노출.
  const folders = useMemo(() => {
    const tree = buildMeetingsTree(meetings ?? [], undefined, emptyFolders ?? []);
    return flattenFolderPaths(tree);
  }, [meetings, emptyFolders]);

  useEffect(() => {
    if (!open) {
      setNewFolderInput("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!meetingId) return null;

  async function commitMove(target: string) {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onMove(target);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSubmitting(false);
    }
  }

  async function handleCreateAndMove() {
    const trimmed = newFolderInput.trim();
    if (trimmed === "") {
      setError("폴더 이름을 입력하세요");
      return;
    }
    await commitMove(trimmed);
  }

  return (
    <Modal open={open} onClose={onClose} size="sm" ariaLabel="폴더로 이동">
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--line-2)" }}
      >
          <div className="min-w-0">
            <Text variant="body" weight="semibold" as="div">
              폴더로 이동
            </Text>
            <Text
              variant="caption"
              color="muted"
              as="div"
              truncate
              className="mt-0.5"
            >
              {meetingTitle || "(제목 없음)"}
            </Text>
          </div>
          <Button
            variant="icon"
            onClick={onClose}
            aria-label="닫기"
            style={{ color: "var(--faint)" }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[40vh] overflow-y-auto px-2 py-2">
          {folders.map((f) => {
            const isCurrent = f === currentFolder;
            return (
              <Button
                key={f || "__root__"}
                variant="ghost"
                onClick={() => void commitMove(f)}
                disabled={isCurrent || submitting}
                className="w-full justify-start gap-2 px-3 py-2 disabled:opacity-50"
                style={{
                  color: "var(--ink)",
                  backgroundColor: isCurrent
                    ? "var(--surface-3)"
                    : undefined,
                }}
              >
                {f === "" ? (
                  <FolderRoot
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: "var(--faint)" }}
                  />
                ) : (
                  <Folder
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: "var(--faint)" }}
                  />
                )}
                <span className="truncate">
                  {f === "" ? "최상위" : f}
                </span>
                {isCurrent ? (
                  <Text
                    variant="caption"
                    color="muted"
                    as="span"
                    className="ml-auto"
                  >
                    현재
                  </Text>
                ) : null}
              </Button>
            );
          })}
        </div>

        <div
          className="space-y-2 px-3 py-3"
          style={{ borderTop: "1px solid var(--line-2)" }}
        >
          <div className="flex items-center gap-2">
            <Plus
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--faint)" }}
            />
            <input
              ref={inputRef}
              type="text"
              value={newFolderInput}
              onChange={(e) => setNewFolderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateAndMove();
                }
              }}
              placeholder="새 폴더 이름 (예: work 또는 work/2026)"
              disabled={submitting}
              className="flex-1 rounded-md px-2 py-1.5 text-sm outline-none"
              style={{
                backgroundColor: "var(--bg)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreateAndMove()}
              disabled={submitting || newFolderInput.trim() === ""}
              className="disabled:opacity-50"
            >
              이동
            </Button>
          </div>
          {error ? (
            <Text
              variant="caption"
              as="div"
              className="rounded px-2 py-1"
              style={{
                borderLeft: "2px solid var(--down)",
                backgroundColor: "var(--down-soft)",
                color: "var(--down-ink)",
              }}
            >
              {error}
            </Text>
          ) : null}
        </div>
    </Modal>
  );
}
