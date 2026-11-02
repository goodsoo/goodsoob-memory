import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MoreHorizontal } from "lucide-react";
import { Dropdown, useToast, type DropdownItem } from "@goodsoob/ds";
import { Button } from "../components/common/Button";
import { EmptyState } from "../components/common/EmptyState";
import { PageHeaderBar } from "../components/common/PageHeaderBar";
import { Text } from "../components/common/Text";
import { TranscriptTurns } from "../components/meetings/TranscriptTurns";
import type { SeekRequest } from "../components/meetings/SectionAudio";
import { AudioPlayer } from "../components/recordings/AudioPlayer";
import { NextStepCard } from "../components/recordings/NextStepCard";
import { ReviewDetail } from "../components/recordings/ReviewDetail";
import {
  formatDuration,
  recordingErrorMessage,
  recordingSubtitle,
  recordingWhen,
} from "../components/recordings/recordingLabels";
import { useRecordingDelete } from "../components/recordings/useRecordingDelete";
import {
  useCompleteRecording,
  useDecideReview,
  useLinkRecording,
  useRecordingReview,
  useRecordings,
} from "../hooks/useRecordings";
import { useWorkingTranscript } from "../hooks/useWorkingTranscript";
import { groupInbox, nextAfterRemoval } from "../lib/recordings/inbox";
import { needsMoveRepair, type RecordingItem } from "../lib/recordings/merge";
import { processingErrorMessage } from "../lib/recordings/processing";
import {
  acceptHighlight,
  mapReviewHighlights,
  nextHighlightId,
  turnTextChanged,
} from "../lib/recordings/review";
import { parseTranscript, serializeTranscript } from "../lib/recordings/turns";
import type { ReviewDecision } from "../api/recordings";

export type SelectRecording = (base: string, opts?: { replace?: boolean }) => void;

type Props = {
  selectedBase: string | null;
  onSelect: SelectRecording;
  /** 선택 해제 (처리할 것이 비었을 때). */
  onClear: () => void;
  onOpenMeeting: (uid: string) => void;
};

// "이사 미완료" 자동 복구는 세션당 base 1회 (실패가 반복 toast 되지 않게).
const REPAIR_ATTEMPTED = new Set<string>();

// 녹음 탭 = 인박스이자 작업대 (docs/designs/recording-redesign.md).
// 진입 시 처리할 것 맨 위를 연다. 연결·삭제가 끝나면 처리할 것의 다음 녹음으로.
export function RecordingsPage({ selectedBase, onSelect, onClear, onOpenMeeting }: Props) {
  const { items, isLoading } = useRecordings();
  const link = useLinkRecording();
  const toast = useToast();

  // 탭 진입 시 "이사 미완료" 녹음을 조용히 마무리 (서버 link 는 멱등).
  useEffect(() => {
    if (!items) return;
    for (const it of items) {
      if (!needsMoveRepair(it) || REPAIR_ATTEMPTED.has(it.entry.base)) continue;
      REPAIR_ATTEMPTED.add(it.entry.base);
      link.link({ base: it.entry.base, memoUid: it.memos[0].uid }).catch((err) => {
        toast.show(`녹음 이사를 마무리하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" });
      });
    }
    // link·toast 는 매 렌더 새 객체 — items 변화에만 반응.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const groups = useMemo(() => (items ? groupInbox(items) : null), [items]);
  const todoOrder = useMemo(() => groups?.todo.map((i) => i.entry.base) ?? [], [groups]);

  // 진입 시 처리할 것 맨 위 자동 선택 (history 는 replace — 뒤로가기가 빈 화면에 멈추지 않게).
  useEffect(() => {
    if (selectedBase || todoOrder.length === 0) return;
    onSelect(todoOrder[0], { replace: true });
  }, [selectedBase, todoOrder, onSelect]);

  const selected = items?.find((i) => i.entry.base === selectedBase) ?? null;

  const advanceAfterDelete = useCallback(
    (deleted: string[]) => {
      if (!selectedBase || !deleted.includes(selectedBase)) return;
      const next = nextAfterRemoval(todoOrder, deleted, selectedBase);
      if (next) onSelect(next);
      else onClear();
    },
    [selectedBase, todoOrder, onSelect, onClear],
  );
  const advanceAfterLink = useCallback(
    (base: string) => {
      const next = nextAfterRemoval(todoOrder, [base], base);
      if (next) onSelect(next);
    },
    [todoOrder, onSelect],
  );

  return (
    <div className="flex min-h-svh flex-col lg:h-full lg:min-h-0">
      <PageHeaderBar
        center={
          <Text variant="h4" as="h2">
            녹음
          </Text>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="recording-scroll">
        {selected ? (
          <RecordingDetail
            key={selected.entry.base}
            item={selected}
            onOpenMeeting={onOpenMeeting}
            onLinked={() => advanceAfterLink(selected.entry.base)}
            onDeleted={advanceAfterDelete}
          />
        ) : isLoading ? null : selectedBase ? (
          <EmptyState
            className="px-6 py-16"
            title="녹음을 찾을 수 없습니다"
            description="녹음 파일이 옮겨졌거나 삭제됐을 수 있습니다. 목록에서 다른 녹음을 선택하세요."
          />
        ) : todoOrder.length === 0 ? (
          <EmptyState
            className="px-6 py-16"
            icon={<Mic className="h-6 w-6" aria-hidden />}
            title="처리할 녹음이 없습니다"
            description="새 녹음은 전사가 끝나면 이 목록에 나타납니다. 왼쪽 끝난 것에서 지난 녹음을 열 수 있습니다."
          />
        ) : null}
      </div>
    </div>
  );
}

// ── 상세 = 작업대 ────────────────────────────────────────────────────────────

function RecordingDetail({
  item,
  onOpenMeeting,
  onLinked,
  onDeleted,
}: {
  item: RecordingItem;
  onOpenMeeting: (uid: string) => void;
  onLinked: () => void;
  onDeleted: (deleted: string[]) => void;
}) {
  const { entry, status } = item;
  const { destination, pipeline } = status;
  const toast = useToast();
  const subtitle = recordingSubtitle(entry);
  const duration = formatDuration(entry.durationSec);
  const del = useRecordingDelete(onDeleted);
  const complete = useCompleteRecording();
  const decide = useDecideReview(entry.base);
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const [rediarize, setRediarize] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState<{ turnIndex: number; nonce: number } | null>(null);
  // 직접 고침으로 연 후보 — 그 턴 발화가 실제로 바뀌어 저장되면 "edited" 로 기록.
  const pendingEditRef = useRef<{ id: number; turnIndex: number } | null>(null);
  const lastHighlightRef = useRef<string | null>(null);

  const processing = pipeline === "processing";
  const undecided = destination === "undecided";
  const workEnabled = undecided && pipeline !== "waiting";
  const workVersion = [entry.stt.done, entry.stt.diarized, entry.hasTxt, entry.stt.anchored, processing].join("|");
  const work = useWorkingTranscript(entry.base, workVersion, workEnabled);
  const reviewQ = useRecordingReview(
    entry.base,
    [entry.stt.anchored, entry.stt.diarized].join("|"),
    undecided && pipeline === "review",
  );

  const text = work.data?.text ?? null;
  const parsed = useMemo(() => (text !== null ? parseTranscript(text) : null), [text]);
  const mapping = useMemo(
    () => (parsed && reviewQ.data && pipeline === "review" ? mapReviewHighlights(parsed, reviewQ.data) : null),
    [parsed, reviewQ.data, pipeline],
  );
  const highlights = mapping?.highlights ?? [];

  const readOnly = !undecided || processing || work.data?.source === "raw";

  function recordDecision(id: number, decision: ReviewDecision) {
    decide.mutate(
      { id, decision },
      { onError: (err) => toast.show(`결정을 저장하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" }) },
    );
  }

  function onTextChange(next: string) {
    const pe = pendingEditRef.current;
    if (pe && parsed && turnTextChanged(parsed, parseTranscript(next), pe.turnIndex)) {
      pendingEditRef.current = null;
      work.setText(next);
      void work.flush().then((ok) => ok && recordDecision(pe.id, "edited"));
      return;
    }
    work.setText(next);
  }

  async function accept(id: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h || !parsed) return;
    const next = acceptHighlight(parsed, h);
    setActiveId(null);
    if (!next) {
      toast.show("구절 위치가 바뀌어 수락하지 못했습니다. 직접 고치세요.", { variant: "warn" });
      return;
    }
    work.setText(serializeTranscript(next));
    if (await work.flush()) recordDecision(h.item.id, "accepted");
  }

  function keep(id: number) {
    setActiveId(null);
    recordDecision(id, "kept");
  }

  function editDirectly(id: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    setActiveId(null);
    pendingEditRef.current = { id: h.item.id, turnIndex: h.turnIndex };
    setEditRequest((prev) => ({ turnIndex: h.turnIndex, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  function openHighlight(id: string) {
    lastHighlightRef.current = id;
    setActiveId(id);
  }

  function goNextHighlight() {
    const id = nextHighlightId(highlights, activeId ?? lastHighlightRef.current);
    if (!id) return;
    const el = document.querySelector(`[data-highlight-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "center" });
    // 스크롤이 끝난 다음 프레임에 열어야 팝오버가 새 위치에 붙는다.
    requestAnimationFrame(() => openHighlight(id));
  }

  async function doComplete() {
    if (!(await work.flush())) return;
    complete.mutate(entry.base, {
      onSuccess: () => toast.show("교정을 완료했습니다. 이제 메모에 연결할 수 있습니다.", { variant: "ok" }),
      onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
    });
  }

  const canRediarize =
    undecided && entry.hasM4a && entry.stt.diarized && (pipeline === "correction" || pipeline === "review" || pipeline === "error");
  const menuItems: DropdownItem[] = [];
  if (canRediarize) menuItems.push({ key: "rediarize", label: "화자 다시 나누기", onSelect: () => setRediarize(true) });
  menuItems.push({
    key: "delete",
    label: "삭제",
    tone: "danger",
    disabled: processing,
    onSelect: () => del.request([entry.base]),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16">
      <header className="flex items-start gap-3 pt-6 pb-3">
        <div className="min-w-0 flex-1">
          <Text variant="h3" as="h3">
            {recordingWhen(entry)}
            {duration ? (
              <Text variant="h3" as="span" weight="normal" color="secondary" className="tabular-nums">
                {" "}
                · {duration}
              </Text>
            ) : null}
          </Text>
          <Text variant="caption" color="muted" as="div" className="font-mono break-all">
            {subtitle ? `${subtitle} · ` : ""}
            {entry.base}
          </Text>
        </div>
        <Dropdown
          trigger={
            <Button variant="icon" title="녹음 메뉴" aria-label="녹음 메뉴">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
          items={menuItems}
        />
      </header>

      {entry.hasM4a ? (
        <div
          className="backdrop-blur py-2"
          data-testid="recording-player"
          style={{
            position: "sticky",
            top: 0,
            zIndex: "var(--z-sticky)",
            backgroundColor: "var(--surface-frost)",
          }}
        >
          <AudioPlayer base={entry.base} syncPending={entry.syncPending} seek={seek} />
        </div>
      ) : null}

      <div className="space-y-6 pt-4">
        <NextStepCard
          item={item}
          onOpenMeeting={onOpenMeeting}
          onLinked={onLinked}
          remaining={mapping?.remaining ?? entry.stt.reviewLeft}
          unmatched={mapping?.unmatched ?? []}
          onNextHighlight={goNextHighlight}
          onKeepUnmatched={keep}
          onComplete={() => void doComplete()}
          completing={complete.isPending}
          rediarize={rediarize}
          onRediarizeClose={() => setRediarize(false)}
        />

        {workEnabled ? (
          <section aria-label="전사">
            {work.data?.source === "raw" ? (
              <Text variant="caption" color="muted" as="div" className="pb-3">
                초벌 전사입니다. 화자분리 후 고칠 수 있습니다.
              </Text>
            ) : null}
            {text !== null ? (
              <TranscriptTurns
                text={text}
                onChange={readOnly ? undefined : onTextChange}
                readOnly={readOnly}
                onSeek={entry.hasM4a ? (sec) => setSeek((p) => ({ sec, nonce: (p?.nonce ?? 0) + 1 })) : undefined}
                highlights={highlights}
                activeHighlightId={activeId}
                onHighlightClick={openHighlight}
                onHighlightClose={() => setActiveId(null)}
                renderHighlightDetail={(id) => {
                  const h = highlights.find((x) => x.id === id);
                  return h ? (
                    <ReviewDetail
                      highlight={h}
                      busy={decide.isPending}
                      onAccept={() => void accept(id)}
                      onKeep={() => keep(h.item.id)}
                      onEdit={() => editDirectly(id)}
                    />
                  ) : null;
                }}
                editRequest={editRequest}
              />
            ) : work.error ? (
              <Text variant="caption" color="danger" as="div">
                전사본을 읽지 못했습니다. {recordingErrorMessage(work.error)}
              </Text>
            ) : null}
          </section>
        ) : null}
      </div>
      {del.dialog}
    </div>
  );
}
