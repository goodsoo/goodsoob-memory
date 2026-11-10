import { useId, useMemo, useRef, useState } from "react";
import { Button, Field, Input, ListGroup, ListRow, Modal, SearchField, useToast } from "@goodsoob/ds";
import { useMeetings } from "../../hooks/useMeetings";
import { useCompleteRecording, useLinkRecording, type LinkVars } from "../../hooks/useRecordings";
import { formatDisplayDate } from "../../lib/dates";
import { rankLinkCandidates, type MemoRef, type RecordingItem } from "../../lib/recordings/merge";
import { processingErrorMessage } from "../../lib/recordings/processing";
import { Text } from "../common/Text";
import { recordingErrorMessage } from "./recordingLabels";

export const SEND_NOTICE =
  "보내면 음성 기록이 이 메모로 옮겨집니다. 그 뒤에는 녹음 화면에서 고칠 수 없고 메모의 음성 기록에서 고칩니다.";

const CANDIDATE_LIMIT = 3;
const SEARCH_LIMIT = 20;

type Target = { kind: "memo"; memo: MemoRef } | { kind: "new"; title: string; folder: string };

type Props = {
  item: RecordingItem;
  open: boolean;
  onClose: () => void;
  /** 남은 고칠 곳 수 (위치 못 찾은 것 포함) — 0 이면 안내 생략. */
  remaining: number;
  /** 고친 내용 즉시 저장. 실패면 false (저장 훅이 토스트를 띄운다). */
  flush: () => Promise<boolean>;
  /** 보내기 성공 — 다음 녹음으로. */
  onSent: () => void;
};

/** pipeline 이 교정본(corrected)·글만(textOnly)이 아니면 보내기 전에 교정 완료(complete)를 먼저 부른다. */
export function needsComplete(item: RecordingItem): boolean {
  const p = item.status.pipeline;
  return p !== "corrected" && p !== "textOnly";
}

/**
 * 메모로 보내기 창. 메모 행을 누르면 바로 보낸다(창 자체가 확인 단계).
 * 순서: flush → (필요하면) complete → link. link 가 실패하면 창은 열린 채 토스트만 띄운다.
 */
export function SendToMemoDialog({ item, open, onClose, remaining, flush, onSent }: Props) {
  return (
    <Modal open={open} onClose={onClose} size="md" backdrop="scrim" ariaLabel="메모로 보내기">
      {open ? <SendBody item={item} remaining={remaining} flush={flush} onSent={onSent} /> : null}
    </Modal>
  );
}

function SendBody({ item, remaining, flush, onSent }: Omit<Props, "open" | "onClose">) {
  const { entry } = item;
  const toast = useToast();
  const meetingsQ = useMeetings();
  const link = useLinkRecording();
  const complete = useCompleteRecording();
  const memos = useMemo<MemoRef[]>(() => meetingsQ.data ?? [], [meetingsQ.data]);
  const candidates = useMemo(() => {
    const r = rankLinkCandidates(entry, memos);
    return [...r.inWindow, ...r.sameDate].slice(0, CANDIDATE_LIMIT);
  }, [entry, memos]);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("inbox");
  const [busy, setBusy] = useState(false);
  // complete 는 성공했는데 link 가 실패한 뒤 다시 시도할 때 complete 를 또 부르지 않게.
  const completedRef = useRef(false);
  const formId = useId();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return memos
      .filter((m) => !m.audio.includes(entry.base) && (m.title || "").toLowerCase().includes(q))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SEARCH_LIMIT);
  }, [memos, query, entry.base]);

  async function send(t: Target) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      if (needsComplete(item) && !completedRef.current) {
        try {
          await complete.mutateAsync(entry.base);
          completedRef.current = true;
        } catch (err) {
          toast.show(processingErrorMessage(err), { variant: "down" });
          return;
        }
      }
      const vars: LinkVars =
        t.kind === "memo"
          ? { base: entry.base, memoUid: t.memo.uid }
          : { base: entry.base, newMemo: { title: t.title, folder: t.folder || undefined } };
      try {
        await link.link(vars);
      } catch (err) {
        toast.show(recordingErrorMessage(err), { variant: "down" });
        return;
      }
      const name = t.kind === "memo" ? t.memo.title?.trim() : t.title;
      toast.show(name ? `'${name}' 메모로 보냈습니다.` : "메모로 보냈습니다.", { variant: "ok" });
      onSent();
    } finally {
      setBusy(false);
    }
  }

  const notice = remaining > 0 ? `${SEND_NOTICE} 남은 고칠 곳 ${remaining}개는 그대로 둡니다.` : SEND_NOTICE;

  return (
    <>
      <Modal.Header>
        <Text variant="h4" as="h2">
          메모로 보내기
        </Text>
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-4">
          <Text variant="body" color="secondary" as="p" data-testid="send-notice">
            {notice}
          </Text>

          {candidates.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Text variant="caption" color="muted" weight="semibold" as="div">
                같은 날 메모
              </Text>
              <MemoRows memos={candidates} disabled={busy} onPick={(m) => void send({ kind: "memo", memo: m })} />
            </div>
          ) : (
            <Text variant="caption" color="muted" as="div">
              같은 날 메모가 없습니다. 아래에서 메모를 찾거나 새 메모를 만드세요.
            </Text>
          )}

          <div className="flex flex-col gap-2">
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              placeholder="메모 제목을 검색하세요"
              aria-label="메모 검색"
            />
            {query.trim() ? (
              results.length > 0 ? (
                <MemoRows memos={results} disabled={busy} onPick={(m) => void send({ kind: "memo", memo: m })} />
              ) : (
                <Text variant="caption" color="muted" as="div">
                  일치하는 메모가 없습니다.
                </Text>
              )
            ) : null}
          </div>

          {showNew ? (
            <form
              id={formId}
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                void send({ kind: "new", title: title.trim(), folder: folder.trim() });
              }}
            >
              <Field label="제목" layout="vertical" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목을 입력하세요" autoFocus />
              </Field>
              <Field label="폴더" layout="vertical" hint="비우면 inbox 에 만듭니다.">
                <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="폴더를 입력하세요" />
              </Field>
            </form>
          ) : null}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex items-center gap-2">
          {showNew ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>
                취소
              </Button>
              <Button type="submit" form={formId} variant="primary" disabled={busy || !title.trim()}>
                새 메모로 보내기
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setShowNew(true)}>
              새 메모
            </Button>
          )}
        </div>
      </Modal.Footer>
    </>
  );
}

function MemoRows({
  memos,
  disabled,
  onPick,
}: {
  memos: readonly MemoRef[];
  disabled: boolean;
  onPick: (m: MemoRef) => void;
}) {
  return (
    <ListGroup>
      {memos.map((m) => (
        <ListRow
          key={m.uid}
          label={<span className="block min-w-0 truncate">{m.title?.trim() || "(제목 없음)"}</span>}
          value={m.date ? formatDisplayDate(m.date) : undefined}
          disabled={disabled}
          onClick={() => onPick(m)}
        />
      ))}
    </ListGroup>
  );
}
