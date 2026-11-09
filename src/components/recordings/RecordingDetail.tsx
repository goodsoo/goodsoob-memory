import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@goodsoob/ds";
import type { ReviewDecision } from "../../api/recordings";
import { useAudioPlayback } from "../../hooks/useAudioPlayback";
import { useFollowPlayback } from "../../hooks/useFollowPlayback";
import { useRecordingReview, useDecideReview } from "../../hooks/useRecordings";
import { useRecordingShortcuts, type RecordingShortcutHandlers } from "../../hooks/useRecordingShortcuts";
import { useWorkingTranscript } from "../../hooks/useWorkingTranscript";
import { findInTranscript, replaceAll, replaceOne } from "../../lib/recordings/find";
import type { RecordingItem } from "../../lib/recordings/merge";
import { activeTurnAt, nextTurnTarget, prevTurnTarget } from "../../lib/recordings/playback";
import {
  acceptHighlight,
  mapReviewHighlights,
  nextHighlightId,
  turnTextChanged,
} from "../../lib/recordings/review";
import { parseTranscript, serializeTranscript, turnsOf } from "../../lib/recordings/turns";
import { FindBar } from "../meetings/FindBar";
import { TranscriptTurns, type TranscriptHighlight } from "../meetings/TranscriptTurns";
import { Text } from "../common/Text";
import { PlaybackBar } from "./PlaybackBar";
import { RecordingStatusLine, statusView, type StatusAction } from "./RecordingStatusLine";
import { recordingErrorMessage } from "./recordingLabels";
import { ReviewDetail } from "./ReviewDetail";
import { SendToMemoDialog } from "./SendToMemoDialog";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";
import { SplitSpeakersDialog } from "./SplitSpeakersDialog";
import { UnmatchedCandidates } from "./UnmatchedCandidates";
import { useRecordingDelete } from "./useRecordingDelete";

type FindState = {
  open: boolean;
  query: string;
  cs: boolean;
  /** 0-based 현재 매치. */
  active: number;
  replace: string;
  expanded: boolean;
};

const FIND_CLOSED: FindState = { open: false, query: "", cs: false, active: 0, replace: "", expanded: false };
const FIND_PREFIX = "find-";

function scrollToHighlight(id: string) {
  const el = document.querySelector(`[data-highlight-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: "center" });
}

type Props = {
  item: RecordingItem;
  onOpenMeeting: (uid: string) => void;
  /** 메모로 보내기 성공 — 다음 녹음으로. */
  onSent: () => void;
  onDeleted: (deleted: string[]) => void;
};

/**
 * 녹음 상세 = 작업대 (docs/designs/recording-ux.md A).
 * 스크롤 영역(머리 + 문단) · 찾기 바 · 재생 막대를 형제로 렌더한다 — 바깥(RecordingsPage)이 relative.
 * 단축키 리스너는 이 컴포넌트가 떠 있는 동안만 켜진다.
 */
export function RecordingDetail({ item, onOpenMeeting, onSent, onDeleted }: Props) {
  const { entry, status } = item;
  const { destination, pipeline } = status;
  const toast = useToast();
  const del = useRecordingDelete(onDeleted);
  const decide = useDecideReview(entry.base);
  const player = useAudioPlayback({ base: entry.base, syncPending: entry.syncPending });

  const [split, setSplit] = useState<{ open: boolean; rediarize: boolean }>({ open: false, rediarize: false });
  const [sendOpen, setSendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState<{ turnIndex: number; nonce: number } | null>(null);
  const [find, setFind] = useState<FindState>(FIND_CLOSED);
  const findInputRef = useRef<HTMLInputElement>(null);
  // 직접 고침으로 연 후보 — 그 턴 발화가 실제로 바뀌어 저장되면 "edited" 로 기록.
  const pendingEditRef = useRef<{ id: number; turnIndex: number } | null>(null);
  const lastHighlightRef = useRef<string | null>(null);
  // N / "다음 고칠 곳" 으로 연 후보면 결정 뒤 자동으로 다음 후보를 연다.
  const autoNextRef = useRef(false);

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
  const isRaw = work.data?.source === "raw";
  const parsed = useMemo(() => (text !== null ? parseTranscript(text) : null), [text]);
  const mapping = useMemo(
    () => (parsed && reviewQ.data && pipeline === "review" ? mapReviewHighlights(parsed, reviewQ.data) : null),
    [parsed, reviewQ.data, pipeline],
  );
  const highlights = mapping?.highlights ?? [];

  const readOnly = !undecided || processing || pipeline === "error" || isRaw;

  // ── 재생 · 따라 스크롤 ──
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const starts = useMemo(
    () => (parsed && parsed.format !== "plain" ? turnsOf(parsed).map((t) => t.timeSec) : []),
    [parsed],
  );
  const playable = entry.hasM4a && player.state === "ready";
  const timed = entry.hasM4a && starts.length > 0 && !isRaw;
  // 재생을 한 번도 안 했으면 첫 문단에 배경을 깔지 않는다.
  const showActive = timed && (player.playing || player.currentSec > 0);
  const activeTurnIndex = showActive ? activeTurnAt(starts, player.currentSec) : -1;
  const follow = useFollowPlayback({ scrollEl, activeIndex: activeTurnIndex, suspended: editing });

  // 문단 고치는 중(스크롤 영역 안 textarea 포커스) = 따라가기 잠시 멈춤.
  useEffect(() => {
    if (!scrollEl) return;
    const sync = () => {
      const a = document.activeElement;
      setEditing(!!a && a.tagName === "TEXTAREA" && scrollEl.contains(a));
    };
    const later = () => requestAnimationFrame(sync);
    scrollEl.addEventListener("focusin", sync);
    scrollEl.addEventListener("focusout", later);
    return () => {
      scrollEl.removeEventListener("focusin", sync);
      scrollEl.removeEventListener("focusout", later);
    };
  }, [scrollEl]);

  function seekTurn(sec: number) {
    player.seek(sec, { play: true });
    follow.resume();
  }

  // ── 후보 (수락 · 그대로 두기 · 직접 고치기) ──
  function recordDecision(id: number, decision: ReviewDecision) {
    decide.mutate(
      { id, decision },
      { onError: (err) => toast.show(`선택을 저장하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" }) },
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

  function openHighlight(id: string) {
    lastHighlightRef.current = id;
    setActiveId(id);
  }

  function goToHighlight(id: string) {
    scrollToHighlight(id);
    // 스크롤이 끝난 다음 프레임에 열어야 팝오버가 새 위치에 붙는다.
    requestAnimationFrame(() => openHighlight(id));
  }

  function goNextHighlight() {
    const id = nextHighlightId(highlights, activeId ?? lastHighlightRef.current);
    if (!id) return;
    autoNextRef.current = true;
    goToHighlight(id);
  }

  function goPrevHighlight() {
    if (highlights.length === 0) return;
    const cur = activeId ?? lastHighlightRef.current;
    const i = cur === null ? 0 : highlights.findIndex((h) => h.id === cur);
    const prev = highlights[(Math.max(i, 0) - 1 + highlights.length) % highlights.length];
    autoNextRef.current = true;
    goToHighlight(prev.id);
  }

  /** N 경로로 연 후보를 결정했으면 다음 후보로. */
  function advanceAfter(decidedId: string) {
    if (!autoNextRef.current) return;
    const idx = highlights.findIndex((h) => h.id === decidedId);
    const rest = highlights.filter((h) => h.id !== decidedId);
    if (rest.length === 0) {
      autoNextRef.current = false;
      return;
    }
    const next = highlights.slice(idx + 1).find((h) => h.id !== decidedId) ?? rest[0];
    goToHighlight(next.id);
  }

  async function accept(id: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h || !parsed) return;
    const next = acceptHighlight(parsed, h);
    setActiveId(null);
    if (!next) {
      toast.show("그 부분이 바뀌어 제안대로 바꾸지 못했습니다. 직접 고치세요.", { variant: "warn" });
      return;
    }
    work.setText(serializeTranscript(next));
    if (await work.flush()) {
      recordDecision(h.item.id, "accepted");
      advanceAfter(id);
    }
  }

  function keep(id: number) {
    setActiveId(null);
    recordDecision(id, "kept");
  }

  function keepHighlight(id: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    keep(h.item.id);
    advanceAfter(id);
  }

  function editDirectly(id: string) {
    const h = highlights.find((x) => x.id === id);
    if (!h) return;
    setActiveId(null);
    autoNextRef.current = false;
    pendingEditRef.current = { id: h.item.id, turnIndex: h.turnIndex };
    setEditRequest((prev) => ({ turnIndex: h.turnIndex, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  // ── 찾기 ──
  const matches = useMemo(
    () => (find.open && parsed ? findInTranscript(parsed, find.query, find.cs) : []),
    [find.open, find.query, find.cs, parsed],
  );
  const activeMatch = matches.length > 0 ? Math.min(find.active, matches.length - 1) : -1;
  const findHighlights = useMemo<TranscriptHighlight[]>(
    () =>
      matches.map((m, i) => ({
        id: `${FIND_PREFIX}${i}`,
        turnIndex: m.turnIndex,
        start: m.start,
        end: m.end,
        kind: i === activeMatch ? "find-active" : "find",
      })),
    [matches, activeMatch],
  );

  useEffect(() => {
    if (!find.open || activeMatch < 0) return;
    scrollToHighlight(`${FIND_PREFIX}${activeMatch}`);
  }, [find.open, activeMatch, find.query, find.cs]);

  function openFind() {
    if (!parsed) return;
    setActiveId(null);
    setFind((f) => ({ ...f, open: true }));
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }
  function closeFind() {
    setFind((f) => ({ ...f, open: false }));
  }
  function stepFind(dir: 1 | -1) {
    if (matches.length === 0) return;
    setFind((f) => ({ ...f, active: (Math.max(activeMatch, 0) + dir + matches.length) % matches.length }));
  }
  function doReplaceOne() {
    if (readOnly || !parsed || activeMatch < 0) return;
    work.setText(serializeTranscript(replaceOne(parsed, matches[activeMatch], find.replace)));
  }
  function doReplaceAll() {
    if (readOnly || !parsed || !find.query) return;
    work.setText(serializeTranscript(replaceAll(parsed, find.query, find.replace, find.cs)));
  }

  // 찾기 바 입력칸 밖 Esc = 찾기 닫기 (입력칸 안 Esc 는 FindBar, 문단 편집 중 Esc 는 TurnText 가 처리).
  useEffect(() => {
    if (!find.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[role="dialog"],[role="menu"],[role="listbox"]')) return;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      setFind((f) => ({ ...f, open: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [find.open]);

  // ── 상태 줄 · 버튼 ──
  const view = statusView(item, {
    remaining: pipeline === "review" ? (mapping ? mapping.highlights.length : null) : null,
    unmatched: mapping?.unmatched.length ?? 0,
  });
  const sendRemaining = mapping?.remaining ?? (pipeline === "review" ? entry.stt.reviewLeft : 0);

  function onAction(action: StatusAction) {
    switch (action) {
      case "split":
      case "rerunSplit":
        return setSplit({ open: true, rediarize: false });
      case "send":
        return setSendOpen(true);
      case "nextReview":
        return goNextHighlight();
      case "openMemo": {
        const memo = item.memos[0];
        if (memo) onOpenMeeting(memo.uid);
        return;
      }
    }
  }

  const canRediarize =
    undecided && entry.hasM4a && entry.stt.diarized && (pipeline === "correction" || pipeline === "review" || pipeline === "error");

  // ── 단축키 (창이 열려 있으면 전부 끔) ──
  // 삭제 확인 창은 role="dialog" 라 resolver 의 inOverlay 판정이 막는다.
  const anyDialog = split.open || sendOpen || helpOpen;
  const handlers: RecordingShortcutHandlers = {};
  if (!anyDialog) {
    handlers.help = () => setHelpOpen(true);
    if (workEnabled && parsed) handlers.find = openFind;
    if (playable) {
      handlers.toggle = player.toggle;
      handlers.back = () => player.skip(-5);
      handlers.forward = () => player.skip(5);
      handlers.rateDown = () => player.cycleRate(-1);
      handlers.rateUp = () => player.cycleRate(1);
      if (timed) {
        handlers.prevTurn = () => {
          const cur = player.currentSec;
          seekTurn0(prevTurnTarget(starts, cur, activeTurnAt(starts, cur)));
        };
        handlers.nextTurn = () => {
          const t = nextTurnTarget(starts, activeTurnAt(starts, player.currentSec));
          if (t !== null) seekTurn0(t);
        };
      }
    }
    if (pipeline === "review" && highlights.length > 0 && !find.open) {
      handlers.nextReview = goNextHighlight;
      handlers.prevReview = goPrevHighlight;
    }
    if (!readOnly && workEnabled && text !== null) {
      handlers.undo = () => void work.undo();
      handlers.redo = () => void work.redo();
    }
  }
  // ↑/↓ 는 재생 상태 유지 (seek 기본 play=false).
  function seekTurn0(sec: number) {
    player.seek(sec);
    follow.resume();
  }
  useRecordingShortcuts(handlers);

  return (
    <>
      <div
        ref={setScrollEl}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="recording-scroll"
        tabIndex={-1}
        style={{ outline: "none" }}
      >
        <div className="mx-auto w-full max-w-3xl px-5 pb-16">
          <RecordingStatusLine
            item={item}
            view={view}
            onAction={onAction}
            menu={{
              onRediarize: canRediarize ? () => setSplit({ open: true, rediarize: true }) : undefined,
              refind: undecided && (pipeline === "correction" || pipeline === "review"),
              onDelete: () => del.request([entry.base]),
              deleteDisabled: processing,
            }}
          />

          {workEnabled ? (
            <section aria-label="음성 기록">
              {text !== null ? (
                <TranscriptTurns
                  text={text}
                  onChange={readOnly ? undefined : onTextChange}
                  readOnly={readOnly}
                  onSeek={timed ? seekTurn : undefined}
                  activeTurnIndex={activeTurnIndex >= 0 ? activeTurnIndex : null}
                  highlights={find.open ? findHighlights : highlights}
                  activeHighlightId={find.open ? null : activeId}
                  onHighlightClick={
                    find.open
                      ? (id) => setFind((f) => ({ ...f, active: Number(id.slice(FIND_PREFIX.length)) || 0 }))
                      : (id) => {
                          autoNextRef.current = false;
                          openHighlight(id);
                        }
                  }
                  onHighlightClose={() => {
                    autoNextRef.current = false;
                    setActiveId(null);
                  }}
                  renderHighlightDetail={
                    find.open
                      ? undefined
                      : (id) => {
                          const h = highlights.find((x) => x.id === id);
                          return h ? (
                            <ReviewDetail
                              highlight={h}
                              busy={decide.isPending}
                              onAccept={() => void accept(id)}
                              onKeep={() => keepHighlight(id)}
                              onEdit={() => editDirectly(id)}
                            />
                          ) : null;
                        }
                  }
                  editRequest={editRequest}
                />
              ) : work.error ? (
                <Text variant="caption" color="danger" as="div">
                  음성 기록을 불러오지 못했습니다. {recordingErrorMessage(work.error)}
                </Text>
              ) : null}
              {pipeline === "review" && mapping ? (
                <UnmatchedCandidates items={mapping.unmatched} onKeep={keep} disabled={decide.isPending} />
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {find.open ? (
        <FindBar
          query={find.query}
          onQueryChange={(v) => setFind((f) => ({ ...f, query: v, active: 0 }))}
          caseSensitive={find.cs}
          onToggleCase={() => setFind((f) => ({ ...f, cs: !f.cs, active: 0 }))}
          active={activeMatch + 1}
          total={matches.length}
          onNext={() => stepFind(1)}
          onPrev={() => stepFind(-1)}
          onClose={closeFind}
          inputRef={findInputRef}
          expanded={find.expanded}
          onToggleExpanded={() => setFind((f) => ({ ...f, expanded: !f.expanded }))}
          replaceValue={find.replace}
          onReplaceChange={(v) => setFind((f) => ({ ...f, replace: v }))}
          onReplaceOne={doReplaceOne}
          onReplaceAll={doReplaceAll}
          canReplace={!readOnly}
        />
      ) : null}

      {entry.hasM4a ? (
        <PlaybackBar
          player={player}
          following={follow.following}
          onResumeFollow={follow.resume}
          onOpenHelp={() => setHelpOpen(true)}
        />
      ) : null}

      <SplitSpeakersDialog
        item={item}
        open={split.open}
        rediarize={split.rediarize}
        onClose={() => setSplit({ open: false, rediarize: false })}
      />
      <SendToMemoDialog
        item={item}
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        remaining={sendRemaining}
        flush={work.flush}
        onSent={() => {
          setSendOpen(false);
          onSent();
        }}
      />
      <ShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {del.dialog}
    </>
  );
}
