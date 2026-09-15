import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useUpsertJournal, useDeleteJournal, useJournals } from "../../hooks/useJournals";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import { formatDateLong } from "../../lib/dates";
import { JournalTextArea } from "./JournalTextArea";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { SaveIndicator } from "../common/SaveIndicator";

type Props = {
  open: boolean;
  date: string;
  onClose: () => void;
};

// 같은 날짜로 다시 열어도 ref state 살아남도록 모듈 cache. 다른 날짜는 별개.
// 새로고침 시 reset.
const DRAFT_CACHE = new Map<string, string>();

export function JournalOverlay({ open, date, onClose }: Props) {
  const journalsQ = useJournals();
  const upsertMutation = useUpsertJournal();
  const deleteMutation = useDeleteJournal();

  const existing = (journalsQ.data ?? []).find((j) => j.date === date) ?? null;

  // 초기값: 서버 데이터 > draft cache > 빈 문자열. open 될 때 한 번 결정.
  // open 중에 외부 데이터 바뀌어도 사용자 입력 덮어쓰지 않게 open 분리.
  const [content, setContent] = useState<string>("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const save = useCallback(
    async (value: string) => {
      const isEmpty = value.trim().length === 0;
      if (isEmpty) {
        // 빈 본문 = 삭제 의도 (사용자 명시: "필요하면 내용 전부 지우면 되니까").
        // 1초 debounce 후에도 빈 상태면 자동 delete. existing 없으면 noop.
        if (existing) {
          await deleteMutation.mutateAsync(existing.id);
        }
        return;
      }
      await upsertMutation.mutateAsync({ date, content: value });
    },
    [date, existing, upsertMutation, deleteMutation],
  );

  const { schedule, flush, status } = useDebouncedSave<string>({ save });

  // open 시 초기값 세팅 + draft cache 비움 + 편집 모드로 리셋. 이미 열려있는 채로
  // date prop 만 바뀌면 동일.
  // 의도: open 트리거의 1회 reset — 외부 데이터가 바뀌어도 사용자 입력을 덮어쓰지
  // 않도록 effect 안에서 setContent. effect-set-state warning 은 의도된 패턴이라 무시.
  useEffect(() => {
    if (!open) return;
    const initial = DRAFT_CACHE.get(date) ?? existing?.content ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(initial);
    DRAFT_CACHE.delete(date);
    // existing 이 늦게 도착해도 placeholder 가 유지되도록 open + date 만 dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  // 닫힐 때 pending flush. unmount 시 draft cache 저장 (저장 실패 케이스 보존용).
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  // open 시 자동 focus + 끝으로 caret.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // 모달 단축키 (Escape 는 Modal 컴포넌트가 onClose=handleClose 로 처리):
  //   Cmd/Ctrl+Enter — 저장&닫기
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd || e.altKey || e.shiftKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleChange(next: string) {
    setContent(next);
    schedule(next);
  }

  async function handleClose() {
    await flush();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} size="lg" ariaLabel="일기 작성">
      <header
          className="flex shrink-0 items-center justify-between gap-3 px-5"
          style={{
            height: "3rem",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <h2
            className="font-serif text-sm font-medium"
            style={{ color: "var(--ink)" }}
          >
            {formatDateLong(date)} 일기
          </h2>
          <div className="flex items-center gap-2">
            {status !== "idle" ? (
              <SaveIndicator
                isPending={status === "pending" || status === "saving"}
                isError={status === "error"}
              />
            ) : null}
            <Button
              variant="icon"
              onClick={handleClose}
              aria-label="닫기"
              title="닫기  ESC"
              style={{ color: "var(--faint)" }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        {/* 평문 일기 — 컨테이너 높이를 채우는 textarea(자체 스크롤). px-6 py-5 + font-serif 로 일기 느낌. */}
        <div className="flex min-h-0 flex-1 flex-col px-6 py-5 font-serif text-base">
          <JournalTextArea
            content={content}
            onChange={handleChange}
            placeholder="오늘 어땠어요?"
            textareaRef={taRef}
            onBlur={() => void flush()}
          />
        </div>
    </Modal>
  );
}
