import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, CommittedInput, Popover, Textarea } from "@goodsoob/ds";

import { Text } from "../common/Text";
import {
  parseTranscript,
  renameSpeaker,
  serializeTranscript,
  speakersInOrder,
  updateTurnText,
  type TurnBlock,
} from "../../lib/recordings/turns";
import { AudioSlot, SectionHeadingLabel, type SeekRequest } from "./SectionAudio";

// 화자별 턴 화면 — 녹음 탭(작업 파일)과 메모 음성 기록 탭(사이드카)이 같이 쓰는 공용 컴포넌트.
// 텍스트(원문) in → 편집 결과도 원문 텍스트 out (parse → 수정 → serialize, 읽은 형식 그대로).
// 저장·undo 는 호출측 소유 — 이 컴포넌트는 onChange(nextText) 만 부른다.
//
// - 참석자 줄: "참석자 N명" + 화자 이름(등장 순 색). 편집 가능하면 이름 클릭 = 그 화자 전체 이름 변경.
// - 턴: 색 원(이니셜) · 이름 · 시각(클릭 = seek) · 발화(클릭 = 인라인 편집, Enter/blur 확정, Esc 취소,
//   Shift+Enter 줄바꿈).
// - `## 시각 · base` 녹음 섹션 헤딩 = 구분선 + base 링크 + ▶ (TranscriptView 와 같은 SectionAudio).
//   onSeek 를 안 주면 시각 클릭은 그 섹션 플레이어를 열어 그 지점부터 재생.
// - 턴이 2개 미만(plain)이면 renderPlain(있으면) 또는 평문 표시/textarea.

const SPEAKER_COLOR_COUNT = 10; // index.css 의 --speaker-0..9 와 일치.

export interface TranscriptHighlight {
  /** turn 순번 (heading·text 블록 제외, 0부터). */
  turnIndex: number;
  /** 발화 text 안 문자 offset [start, end). */
  start: number;
  end: number;
  id: string;
  /** 교정 후보 분류 — "A"(자동 제안) · "B"(확인 필요) · "C"(화자 오귀속) 등. */
  kind: string;
}

const NO_HIGHLIGHTS: readonly TranscriptHighlight[] = [];
const NO_BASES: readonly string[] = [];

export interface TranscriptTurnsProps {
  text: string;
  onChange?: (nextText: string) => void;
  readOnly?: boolean;
  /** 섹션 헤딩 ▶ 판정 기준 (메모 frontmatter `audio:`). */
  audioBases?: readonly string[];
  /** 시각 클릭. base = 그 턴이 속한 녹음 섹션(있으면). 미지정 시 섹션 플레이어로 seek. */
  onSeek?: (sec: number, base?: string) => void;
  highlights?: readonly TranscriptHighlight[];
  onHighlightClick?: (id: string) => void;
  /** plain(턴 없음) 일 때 대신 그릴 것 — 메모 보기 모드는 기존 TranscriptView. */
  renderPlain?: () => ReactNode;
  /**
   * 하이라이트 상세 팝오버 내용. 주면 하이라이트 클릭이 그 자리에 팝오버를 연다
   * (열림은 activeHighlightId 로 호출측이 제어, 닫힘 = onHighlightClose).
   */
  renderHighlightDetail?: (id: string) => ReactNode;
  activeHighlightId?: string | null;
  onHighlightClose?: () => void;
  /** 이 턴 발화를 편집 상태로 연다 (nonce 가 바뀔 때마다 한 번). */
  editRequest?: { turnIndex: number; nonce: number } | null;
}

function initialOf(name: string): string {
  const m = /^(?:화자|speaker[ _]?)(\d+)$/i.exec(name);
  if (m) return m[1];
  return Array.from(name)[0] ?? "?";
}

function highlightStyle(kind: string): React.CSSProperties {
  const tone = kind === "C" ? "down" : kind === "B" ? "accent" : "warn";
  return {
    backgroundColor: `var(--${tone}-soft)`,
    borderBottom: `1px solid var(--${tone}-line)`,
    color: "inherit",
    cursor: "pointer",
    borderRadius: "var(--radius-6)",
  };
}

function SpeakerDot({ name, ci, size }: { name: string; ci: number; size: "sm" | "md" }) {
  const px = size === "sm" ? "var(--icon-16)" : "var(--ctl-h)";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: px,
        height: px,
        fontSize: size === "sm" ? "var(--fs-3xs)" : "var(--fs-xs)",
        backgroundColor: `var(--speaker-${ci}-bg)`,
        color: `var(--speaker-${ci}-text)`,
      }}
    >
      {initialOf(name)}
    </span>
  );
}

function PlainFallback({
  text,
  editable,
  onChange,
}: {
  text: string;
  editable: boolean;
  onChange?: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);
  if (editable) {
    return (
      <Textarea
        ref={ref}
        variant="borderless"
        resize="none"
        value={text}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="음성 기록을 입력하세요"
        className="w-full text-base leading-relaxed"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{ color: "var(--ink)", overflowY: "hidden", minHeight: "60vh" }}
      />
    );
  }
  return (
    <div
      className="text-base leading-relaxed"
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--ink)", userSelect: "text" }}
    >
      {text}
    </div>
  );
}

function TurnText({
  turn,
  turnIndex,
  editable,
  highlights,
  onHighlightClick,
  onCommit,
  renderHighlightDetail,
  activeHighlightId,
  onHighlightClose,
  startEditing,
  onEditStarted,
}: {
  turn: TurnBlock;
  turnIndex: number;
  editable: boolean;
  highlights: readonly TranscriptHighlight[];
  onHighlightClick?: (id: string) => void;
  onCommit: (index: number, next: string) => void;
  renderHighlightDetail?: (id: string) => ReactNode;
  activeHighlightId?: string | null;
  onHighlightClose?: () => void;
  startEditing?: boolean;
  onEditStarted?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!startEditing || !editable) return;
    onEditStarted?.();
    setDraft(turn.text);
  }, [startEditing, editable, onEditStarted, turn.text]);

  if (draft !== null) {
    const finish = () => {
      if (cancelRef.current) {
        cancelRef.current = false;
        setDraft(null);
        return;
      }
      const next = draft;
      setDraft(null);
      if (next.trim() !== "" && next !== turn.text) onCommit(turnIndex, next);
    };
    return (
      <Textarea
        autoFocus
        autoGrow
        maxRows={30}
        value={draft}
        aria-label={`${turn.speaker} ${turn.time} 발화 편집`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            cancelRef.current = true;
            e.currentTarget.blur();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full text-base leading-relaxed"
      />
    );
  }

  // 하이라이트 구간 분할 (겹치면 앞 것 우선, 범위 밖은 clamp).
  const segs: ReactNode[] = [];
  const hs = [...highlights].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const h of hs) {
    const s = Math.max(h.start, pos);
    const e = Math.min(h.end, turn.text.length);
    if (e <= s) continue;
    if (s > pos) segs.push(turn.text.slice(pos, s));
    if (renderHighlightDetail) {
      // 팝오버 내용은 portal 이지만 React 이벤트는 트리를 따라 올라오므로, 바깥 span 에서
      // 막아야 발화 편집(클릭·Enter)이 같이 열리지 않는다.
      segs.push(
        <span
          key={h.id}
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
        >
          <Popover
            open={activeHighlightId === h.id}
            onOpenChange={(open) => (open ? onHighlightClick?.(h.id) : onHighlightClose?.())}
            width={320}
            trigger={
              <mark data-highlight-id={h.id} data-kind={h.kind} style={highlightStyle(h.kind)}>
                {turn.text.slice(s, e)}
              </mark>
            }
            content={renderHighlightDetail(h.id)}
          />
        </span>,
      );
    } else {
      segs.push(
        <mark
          key={h.id}
          data-highlight-id={h.id}
          data-kind={h.kind}
          style={highlightStyle(h.kind)}
          onClick={(ev) => {
            ev.stopPropagation();
            onHighlightClick?.(h.id);
          }}
        >
          {turn.text.slice(s, e)}
        </mark>,
      );
    }
    pos = e;
  }
  if (pos < turn.text.length) segs.push(turn.text.slice(pos));

  const startEdit = () => setDraft(turn.text);
  return (
    <div
      className="text-base leading-relaxed rounded"
      data-turn-text
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      title={editable ? "클릭해 고치기" : undefined}
      onClick={editable ? startEdit : undefined}
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                startEdit();
              }
            }
          : undefined
      }
      style={{
        color: "var(--ink)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        userSelect: "text",
        WebkitUserSelect: "text",
        cursor: editable ? "text" : undefined,
      }}
    >
      {segs}
    </div>
  );
}

export function TranscriptTurns({
  text,
  onChange,
  readOnly = false,
  audioBases = NO_BASES,
  onSeek,
  highlights = NO_HIGHLIGHTS,
  onHighlightClick,
  renderPlain,
  renderHighlightDetail,
  activeHighlightId = null,
  onHighlightClose,
  editRequest = null,
}: TranscriptTurnsProps) {
  const editable = !!onChange && !readOnly;
  const parsed = useMemo(() => parseTranscript(text, audioBases), [text, audioBases]);
  const speakers = useMemo(() => speakersInOrder(parsed), [parsed]);
  const colorOf = useMemo(() => {
    const m = new Map<string, number>();
    speakers.forEach((s, i) => m.set(s, i % SPEAKER_COLOR_COUNT));
    return m;
  }, [speakers]);
  const hlByTurn = useMemo(() => {
    const m = new Map<number, TranscriptHighlight[]>();
    for (const h of highlights) {
      const arr = m.get(h.turnIndex) ?? [];
      arr.push(h);
      m.set(h.turnIndex, arr);
    }
    return m;
  }, [highlights]);
  // 블록별 turn 순번 + 속한 녹음 섹션 base (▶ 가 붙는 헤딩만 섹션 경계, sections.ts 와 동일).
  const layout = useMemo(() => {
    const audioSet = new Set(audioBases);
    const out: { turnIndex: number; sectionBase?: string; isAudioHeading: boolean }[] = [];
    let ti = -1;
    let section: string | undefined;
    for (const b of parsed.blocks) {
      const isAudioHeading = b.kind === "heading" && !!b.base && audioSet.has(b.base);
      if (isAudioHeading) section = (b as { base: string }).base;
      if (b.kind === "turn") ti++;
      out.push({ turnIndex: ti, sectionBase: section, isAudioHeading });
    }
    return out;
  }, [parsed, audioBases]);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [openBase, setOpenBase] = useState<string | null>(null);
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  // editRequest 는 nonce 당 한 번만 — 확정 후 턴이 remount 돼도 다시 열리지 않게.
  const [consumedEdit, setConsumedEdit] = useState<number | null>(null);
  const pendingEdit = editRequest && editRequest.nonce !== consumedEdit ? editRequest : null;
  const markEditConsumed = useMemo(
    () => (pendingEdit ? () => setConsumedEdit(pendingEdit.nonce) : undefined),
    [pendingEdit],
  );

  if (parsed.format === "plain") {
    if (renderPlain) return <>{renderPlain()}</>;
    return <PlainFallback text={text} editable={editable} onChange={onChange} />;
  }

  const commitTurn = (index: number, next: string) => {
    const out = serializeTranscript(updateTurnText(parsed, index, next));
    if (out !== text) onChange?.(out);
  };
  const commitRename = (from: string, to: string) => {
    const out = serializeTranscript(renameSpeaker(parsed, from, to));
    if (out !== text) onChange?.(out);
  };
  const seekTo = (sec: number, base?: string) => {
    if (onSeek) return onSeek(sec, base);
    if (!base) return;
    setOpenBase(base);
    setSeek((prev) => ({ sec, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  return (
    <div style={{ minHeight: "60vh" }} className="flex flex-col gap-4" data-testid="transcript-turns">
      {/* 참석자 줄 */}
      <div className="flex flex-wrap items-center gap-2">
        <Text variant="caption" color="muted" weight="semibold" className="whitespace-nowrap">
          참석자 {speakers.length}명
        </Text>
        {speakers.map((s) => {
          const ci = colorOf.get(s) ?? 0;
          if (renaming === s) {
            return (
              <span key={s} className="inline-flex items-center gap-1">
                <SpeakerDot name={s} ci={ci} size="sm" />
                <CommittedInput
                  autoFocus
                  value={s}
                  aria-label={`${s} 이름 변경`}
                  onCommit={(next) => commitRename(s, next)}
                  onBlur={() => setRenaming(null)}
                  style={{ width: "8rem" }}
                />
              </span>
            );
          }
          const label = (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <SpeakerDot name={s} ci={ci} size="sm" />
              <span style={{ color: `var(--speaker-${ci}-text)` }} className="font-semibold">
                {s}
              </span>
            </span>
          );
          return editable ? (
            <Button
              key={s}
              variant="ghost"
              size="sm"
              title="이 화자 이름 전체 변경"
              aria-label={`${s} 이름 변경`}
              onClick={() => setRenaming(s)}
            >
              {label}
            </Button>
          ) : (
            <span key={s}>{label}</span>
          );
        })}
      </div>

      {parsed.blocks.map((b, bi) => {
        if (b.kind === "heading") {
          if (b.base && layout[bi].isAudioHeading) {
            const base = b.base;
            const open = openBase === base;
            // 플레이어는 헤딩 밖 형제 블록 + sticky — 아래 턴의 시각을 눌러도 화면 위에 남는다.
            return (
              <Fragment key={`h${bi}`}>
                <div
                  className="pt-3"
                  style={{ borderTop: "1px solid var(--line)", color: "var(--ink)" }}
                  data-section-base={base}
                >
                  <SectionHeadingLabel
                    prefix={b.raw.slice(0, b.raw.length - base.length)}
                    base={base}
                    open={open}
                    onToggle={() => {
                      setSeek(null);
                      setOpenBase(open ? null : base);
                    }}
                  />
                </div>
                {open ? (
                  <div
                    className="backdrop-blur"
                    data-testid="section-audio-sticky"
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: "var(--z-sticky)",
                      backgroundColor: "var(--surface-frost)",
                    }}
                  >
                    <AudioSlot base={base} seek={seek} onClose={() => setOpenBase(null)} />
                  </div>
                ) : null}
              </Fragment>
            );
          }
          // `# …` 한 단계 줄 = /transcribe 가 남긴 설명 줄(제목·화자·주의) → 회색 작은 글씨.
          // `## …` 이상 = 녹음 아닌 섹션 제목. 둘 다 `#` 기호는 떼고 보여준다 (원문은 그대로).
          const label = b.raw.replace(/^#{1,6} /, "");
          if (/^# /.test(b.raw)) {
            return (
              <Text key={`h${bi}`} variant="caption" color="muted" as="div" style={{ userSelect: "text" }}>
                {label}
              </Text>
            );
          }
          return (
            <Text key={`h${bi}`} variant="h4" as="div" style={{ userSelect: "text" }}>
              {label}
            </Text>
          );
        }
        if (b.kind === "text") {
          return (
            <div
              key={`x${bi}`}
              className="text-base leading-relaxed"
              style={{
                color: "var(--sub)",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                userSelect: "text",
              }}
            >
              {b.raw}
            </div>
          );
        }
        const ti = layout[bi].turnIndex;
        const ci = colorOf.get(b.speaker) ?? 0;
        const base = layout[bi].sectionBase;
        const seekable = !!onSeek || !!base;
        return (
          <div key={`t${bi}`} className="flex gap-3" data-turn-index={ti}>
            <SpeakerDot name={b.speaker} ci={ci} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Text variant="label" weight="bold" className="whitespace-nowrap">
                  {b.speaker}
                </Text>
                {seekable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="이 지점부터 듣기"
                    aria-label={`${b.time} 부터 듣기`}
                    onClick={() => seekTo(b.timeSec, base)}
                    className="font-mono"
                  >
                    {b.time}
                  </Button>
                ) : (
                  <Text variant="caption" color="muted" className="font-mono whitespace-nowrap">
                    {b.time}
                  </Text>
                )}
              </div>
              <TurnText
                key={`${ti}:${b.text}`}
                turn={b}
                turnIndex={ti}
                editable={editable}
                highlights={hlByTurn.get(ti) ?? []}
                onHighlightClick={onHighlightClick}
                onCommit={commitTurn}
                renderHighlightDetail={renderHighlightDetail}
                activeHighlightId={activeHighlightId}
                onHighlightClose={onHighlightClose}
                startEditing={pendingEdit?.turnIndex === ti}
                onEditStarted={pendingEdit?.turnIndex === ti ? markEditConsumed : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
