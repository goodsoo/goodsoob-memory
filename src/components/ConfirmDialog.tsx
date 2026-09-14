import { useEffect, useRef, type ReactNode } from "react";
import { Modal } from "./common/Modal";
import { Button } from "./common/Button";
import { Text } from "./common/Text";

// message 가 string 이면 Text 로 감싸고, ReactNode 면 multi-line/강조 자유.
// div wrap 은 text-sm + secondary 색 토큰 자동 적용.

type Props = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// 디자인 토큰 기반 confirm 모달. ESC = 취소, Enter = 확인, 바깥 클릭 = 취소.
// 첫 focus 는 cancel 에 둠 — destructive 액션의 실수 방지.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!busy) onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onConfirm]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      ariaLabelledBy="confirm-dialog-title"
    >
      <div className="p-5">
        <Text id="confirm-dialog-title" variant="h4" as="h2">
          {title}
        </Text>
        {message ? (
          typeof message === "string" ? (
            <Text variant="body" color="secondary" className="mt-2">
              {message}
            </Text>
          ) : (
            <div
              className="mt-2 text-sm"
              style={{ color: "var(--sub)" }}
            >
              {message}
            </div>
          )
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "info"}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
