import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Table,
  Link,
  Plus,
} from "lucide-react";
import {
  inferLineKinds,
  labelForKind,
  type LineKind,
} from "../../lib/markdownLineKind";
import {
  applyIndent,
  applyEnterContinue,
  applyUrlPaste,
  applyWrap,
  applyLineMove,
  applyLineDuplicate,
  applyLineKindTransform,
  applyArrowSubstitution,
  detectSlashTrigger,
  type EditResult,
} from "../../lib/markdownTyping";
import {
  SlashCommandPopover,
  getSlashOptionsForFilter,
  type SlashOption,
} from "./SlashCommandPopover";

type Props = {
  content: string;
  onChange: (next: string) => void;
  // cursor 가 - [ ] 라인 위에서 ⌘⏎ 누르면 그 라인 텍스트를 부모에게 전달.
  // 부모 (MeetingForm) 가 TaskAddModal prefill 로 띄움. 일방향 복제 — 메모 라인은 그대로.
  onSendLineToInbox?: (lineText: string) => void;
  // 일기/메모/task description 등 다른 소비처에서 폰트·placeholder·blur 핸들러를
  // 갈아끼우려고 추가. 기본값 유지 시 MeetingForm 사용감 변함 없음.
  placeholder?: string;
  // outer flex container 에 적용. textarea 와 mirror 가 font-family/font-size 를
  // 부모에서 inherit 하므로 폰트 override 도 여기서 한다.
  className?: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  onBlur?: () => void;
  // 이미지 paste / drag&drop 핸들러. 파일 받아서 저장 후 vault root 기준 path 반환
  // (예: "notes/_attachments/{slug}/1.png"). null 반환 = 실패 (insert skip).
  // 부모가 지정 안 하면 paste/drop 인터셉트 자체를 안 함 — 기존 동작 유지.
  onImageAttach?: (file: File) => Promise<string | null>;
};

// textarea의 한 줄 높이 (line-height = 1.625rem, text-base 기준).
// wrap 측정이 아직 안 됐을 때 fallback. 측정 끝나면 mirror div 의 per-line offsetHeight 사용.
const LINE_HEIGHT = "1.625rem";
const LINE_HEIGHT_PX = 26; // 1.625rem * 16px
const GUTTER_WIDTH = "1.75rem";
const TEXTAREA_PADDING_LEFT = "0.5rem";
const TEXTAREA_PADDING_BOTTOM = "1rem";

type SlashState = {
  slashStart: number; // value 안 `/` 의 offset
  filter: string;
  selectedIndex: number;
  slashLine: number; // popover top 계산용 (slash 가 있는 줄 index)
};

export function SourceBodyEditor({
  content,
  onChange,
  onSendLineToInbox,
  placeholder = "메모 내용을 적어주세요...",
  className,
  textareaRef: externalTextareaRef,
  onBlur,
  onImageAttach,
}: Props) {
  const [draft, setDraft] = useState(content);
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const [slashState, setSlashState] = useState<SlashState | null>(null);
  // window 레벨로 OS 파일 drag 진입 감지 — textarea 가 짧을 때 (빈 메모) 어디 떨어뜨려야
  // 할지 안 보이던 통증. drag 중에만 textarea 외곽 강조 + min-height 일시 확장.
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // mirror div 가 측정한 source line 별 actual visual height (wrap 포함, px).
  // 초기엔 빈 배열 — 그 동안 GutterMarker 는 LINE_HEIGHT fallback.
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const skipNextValueSyncRef = useRef(true);
  // 다음 render 직후 textarea selection 을 강제로 set 할 위치. Tab/Enter/Paste 같은
  // 프로그램 edit 에서 caret 을 정확히 이동시키기 위함.
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // 방금 자동 변환된 화살표(`->`→`→`, `=>`→`⇒`)의 caret 위치 + 원본 — 바로 다음
  // 입력이 Backspace 면 원복 (스마트 치환). 다른 입력이 오면 기회 소멸.
  const lastArrowSubRef = useRef<{ pos: number; original: string } | null>(null);

  function updateCaretLine() {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    setCaretLine(el.value.slice(0, pos).split("\n").length - 1);
    updateSlashTrigger(el.value, pos);
  }

  // value + caret 위치 기준으로 slash trigger 재평가. 활성 trigger 면 state set,
  // 아니면 close.
  function updateSlashTrigger(value: string, caret: number) {
    const t = detectSlashTrigger(value, caret);
    if (!t) {
      if (slashState) setSlashState(null);
      return;
    }
    const slashLine = value.slice(0, t.slashStart).split("\n").length - 1;
    setSlashState((prev) => {
      // filter 가 바뀌면 selectedIndex 는 0 으로 reset.
      if (!prev || prev.slashStart !== t.slashStart) {
        return {
          slashStart: t.slashStart,
          filter: t.filter,
          selectedIndex: 0,
          slashLine,
        };
      }
      if (prev.filter === t.filter) return prev;
      return { ...prev, filter: t.filter, selectedIndex: 0, slashLine };
    });
  }

  // SlashCommandPopover 옵션 선택 시: `/{filter}` literal 을 제거하고 target kind 로
  // 줄 변환. 변환 후 caret 은 transform 결과의 caret 위치로.
  function commitSlashOption(option: SlashOption) {
    const el = textareaRef.current;
    if (!el || !slashState) return;
    const value = el.value;
    const { slashStart, filter } = slashState;
    const slashEnd = slashStart + 1 + filter.length;
    // 1) `/{filter}` 제거
    const stripped = value.slice(0, slashStart) + value.slice(slashEnd);
    // 2) 그 자리 (slashStart) 의 줄을 target kind 로 변환
    const r = applyLineKindTransform(stripped, slashStart, option.target);
    commitEdit(r);
    setSlashState(null);
  }

  function commitEdit(r: EditResult) {
    pendingSelectionRef.current = { start: r.start, end: r.end };
    skipNextValueSyncRef.current = true;
    setDraft(r.value);
    onChange(r.value);
  }

  // gutter 클릭 → 해당 줄 전체 선택 (줄 시작 ~ 끝, 개행 제외) + focus
  function focusLine(lineIndex: number) {
    const el = textareaRef.current;
    if (!el) return;
    const lines = el.value.split("\n");
    let start = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i++) {
      start += lines[i].length + 1; // +1 = "\n"
    }
    const end = start + (lines[lineIndex]?.length ?? 0);
    el.focus();
    el.setSelectionRange(start, end);
    setCaretLine(lineIndex);
  }

  useEffect(() => {
    if (skipNextValueSyncRef.current) {
      skipNextValueSyncRef.current = false;
      return;
    }
    setDraft(content);
  }, [content]);

  // mirror div 의 자식 (source line 별 div) offsetHeight 측정 → lineHeights state.
  // 변경 없는 경우 setState skip — render loop 차단.
  function measureLineHeights() {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const children = mirror.children;
    const next: number[] = new Array(children.length);
    for (let i = 0; i < children.length; i++) {
      next[i] = (children[i] as HTMLElement).offsetHeight;
    }
    setLineHeights((prev) => {
      if (prev.length !== next.length) return next;
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) return next;
      }
      return prev;
    });
  }

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    measureLineHeights();
    if (pendingSelectionRef.current) {
      const { start, end } = pendingSelectionRef.current;
      el.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
      // caret line 도 새 위치로
      setCaretLine(el.value.slice(0, start).split("\n").length - 1);
    }
  }, [draft]);

  // textarea width 변경 (사이드패널 collapse, 창 리사이즈 등) → mirror 재측정.
  // rAF 로 한 frame 합쳐서 측정 — 연속 리사이즈에서 thrash 회피.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // textarea height 도 wrap 변화로 바뀔 수 있음 — 재계산.
        const ta = textareaRef.current;
        if (ta) {
          ta.style.height = "auto";
          ta.style.height = ta.scrollHeight + "px";
        }
        measureLineHeights();
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // OS Finder 등에서 파일 drag 시작/종료 감지 → textarea 시각 강조 토글.
  // dragenter/dragleave 는 자식 element 통과 시 마다 발화해서 counter 패턴 필요.
  // Files type 만 인식 — 텍스트 selection drag 같은 일반 dnd 는 무시.
  useEffect(() => {
    if (!onImageAttach) return;
    let counter = 0;
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      counter++;
      if (counter === 1) setIsDraggingFiles(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      counter = Math.max(0, counter - 1);
      if (counter === 0) setIsDraggingFiles(false);
    };
    const onDropOrEnd = () => {
      counter = 0;
      setIsDraggingFiles(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDropOrEnd);
    window.addEventListener("dragend", onDropOrEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDropOrEnd);
      window.removeEventListener("dragend", onDropOrEnd);
    };
  }, [onImageAttach]);

  // macOS 의 "스마트 인용 부호와 줄표" 가 -- → — 자동 치환을 emit 할 때,
  // beforeinput inputType "insertReplacementText" 로 들어옴 — preventDefault.
  // textarea props (autoCorrect/spellCheck/autoCapitalize="off") 로 대부분 막히지만
  // 시스템 설정에 따라 안 막히는 케이스 fallback.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    function onBeforeInput(e: Event) {
      const ev = e as InputEvent;
      if (ev.inputType === "insertReplacementText") {
        const d = ev.data ?? "";
        if (d.includes("—") || d.includes("–") || d.includes("“") || d.includes("”") || d.includes("‘") || d.includes("’") || d.includes("…")) {
          e.preventDefault();
        }
      }
    }
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  const lineKinds = useMemo(() => {
    const lines = draft.split("\n");
    const kinds = inferLineKinds(draft);

    // Post-pass 1: ordered list 실제 렌더링 번호 계산.
    // depth별 counter. 첫 item은 source 의 literal 숫자(예 "3.") 사용.
    // 같은 depth에 bullet/checkbox/empty/heading 등 들어오면 해당 depth 이하 reset.
    const counters = new Map<number, number>();
    function resetAtAndDeeper(d: number) {
      for (const key of Array.from(counters.keys())) {
        if (key >= d) counters.delete(key);
      }
    }
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      const isContinuation = "continuation" in k && k.continuation === true;
      if (isContinuation) continue; // 카운터에 영향 X

      if (k.type === "ordered") {
        const d = k.depth;
        if (counters.has(d)) {
          counters.set(d, counters.get(d)! + 1);
        } else {
          const m = lines[i].match(/^\s*(\d+)\.\s/);
          counters.set(d, m ? parseInt(m[1], 10) : 1);
        }
        // 더 깊은 depth는 새 list 시작에서 리셋
        for (const key of Array.from(counters.keys())) {
          if (key > d) counters.delete(key);
        }
        kinds[i] = { ...k, renderedNumber: counters.get(d)! };
      } else if (k.type === "bullet" || k.type === "checkbox") {
        // 같은 depth의 ordered counter 끊김 (mixed type)
        resetAtAndDeeper(k.depth);
      } else if (k.type === "empty" || k.type === "paragraph") {
        counters.clear();
      } else {
        // heading / fence / hr / table / link-def / code-* → 전체 리셋
        counters.clear();
      }
    }

    // Post-pass 2: setext heading 검증 + 윗 줄에 같은 heading 표시.
    // CommonMark: setext heading은 윗 줄이 top-level paragraph일 때만 적용.
    // 윗 줄이 list 내용(item/continuation)이면 ---는 thematic break, ===는 plain text.
    for (let i = 1; i < kinds.length; i++) {
      const k = kinds[i];
      if (k.type === "heading" && k.setext) {
        const prev = kinds[i - 1];
        if (prev.type === "paragraph") {
          kinds[i - 1] = { type: "heading", level: k.level, setext: true };
        } else {
          // setext 적용 불가 → demote
          kinds[i] = k.level === 2 ? { type: "hr" } : { type: "paragraph" };
        }
      }
    }

    // Post-pass 3: continuation 마지막 표시 — 다음 줄이 같은 marker 종류 continuation/항목이
    // 아니면 lastContinuation = true. gutter dotted vertical (중간) vs dotted corner (마지막).
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      const isContinuation = "continuation" in k && k.continuation === true;
      if (!isContinuation) continue;
      const next = kinds[i + 1];
      const sameTypeContinues = !!next && next.type === k.type;
      if (!sameTypeContinues) {
        kinds[i] = { ...k, lastContinuation: true } as LineKind;
      }
    }

    return kinds;
  }, [draft]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME composition (한글 등) 중에는 절대 가로채지 않음.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const ta = e.currentTarget;
    // 방금 자동 변환된 화살표 → 바로 Backspace 면 원본(`->`/`=>`)으로 원복. 그 외
    // 키는 기회 소멸 (ref 는 매 keydown 에서 소비). caret 이 화살표 직후일 때만.
    const arrowSub = lastArrowSubRef.current;
    lastArrowSubRef.current = null;
    if (
      arrowSub &&
      e.key === "Backspace" &&
      !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
      ta.selectionStart === ta.selectionEnd &&
      ta.selectionStart === arrowSub.pos
    ) {
      e.preventDefault();
      const v = ta.value;
      const newValue =
        v.slice(0, arrowSub.pos - 1) + arrowSub.original + v.slice(arrowSub.pos);
      const newCaret = arrowSub.pos - 1 + arrowSub.original.length;
      commitEdit({ value: newValue, start: newCaret, end: newCaret });
      return;
    }
    // 슬래시 커맨드 popover 열려있을 때 — 위/아래/Enter/Tab/Esc 가로채기.
    if (slashState) {
      const opts = getSlashOptionsForFilter(slashState.filter);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (opts.length === 0) return;
        setSlashState({
          ...slashState,
          selectedIndex: (slashState.selectedIndex + 1) % opts.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (opts.length === 0) return;
        setSlashState({
          ...slashState,
          selectedIndex:
            (slashState.selectedIndex - 1 + opts.length) % opts.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (opts.length === 0) {
          setSlashState(null);
          return; // native 동작 진행 (Enter list continue 등)
        }
        e.preventDefault();
        const chosen = opts[Math.min(slashState.selectedIndex, opts.length - 1)];
        commitSlashOption(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashState(null);
        return;
      }
      // 다른 키 (typing 등) 는 통과 — onChange 가 다시 trigger 평가.
    }
    if (e.key === "Tab" && !e.altKey) {
      // Opt+Tab 은 window-level sub-tab cycle 로 양보 (MeetingForm).
      // 항상 preventDefault — applyIndent 가 null 이어도 native Tab 이 prev focusable
      // (참석자 input 등) 로 빠져나가는 것 차단. textarea 안 머무름.
      e.preventDefault();
      const r = applyIndent(
        ta.value,
        ta.selectionStart,
        ta.selectionEnd,
        e.shiftKey,
      );
      if (r) commitEdit(r);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey || e.altKey)) {
      const r = applyEnterContinue(ta.value, ta.selectionStart, ta.selectionEnd);
      if (r) {
        e.preventDefault();
        commitEdit(r);
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    // ⌘⏎ — cursor 라인이 - [ ] 면 그 라인 텍스트 inbox 로 보내기 (일방향 복제)
    if (mod && e.key === "Enter" && !e.shiftKey && !e.altKey && onSendLineToInbox) {
      const value = ta.value;
      const pos = ta.selectionStart ?? 0;
      const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
      const lineEndIdx = value.indexOf("\n", pos);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const lineText = value.slice(lineStart, lineEnd);
      if (/^\s*-\s\[[ x]\]\s/.test(lineText)) {
        e.preventDefault();
        onSendLineToInbox(lineText);
        return;
      }
    }
    // ⌘B / ⌘I / ⌘E — bold / italic / inline-code wrap toggle
    if (
      mod && !e.shiftKey && !e.altKey &&
      (e.code === "KeyB" || e.code === "KeyI" || e.code === "KeyE")
    ) {
      const mark =
        e.code === "KeyB" ? "**" : e.code === "KeyI" ? "*" : "`";
      e.preventDefault();
      commitEdit(applyWrap(ta.value, ta.selectionStart, ta.selectionEnd, mark));
      return;
    }
    // ⌘Shift+D 줄 복제
    if (mod && e.shiftKey && !e.altKey && e.code === "KeyD") {
      e.preventDefault();
      commitEdit(applyLineDuplicate(ta.value, ta.selectionStart, ta.selectionEnd));
      return;
    }
    // Alt+↑/↓ 줄 이동
    if (e.altKey && !mod && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const dir = e.key === "ArrowUp" ? "up" : "down";
      const r = applyLineMove(ta.value, ta.selectionStart, ta.selectionEnd, dir);
      if (r) {
        e.preventDefault();
        commitEdit(r);
      }
      return;
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    // 이미지 paste — onImageAttach 가 있을 때만 가로채기. clipboardData.items 안
    // file kind 의 image/* 가 한 개라도 있으면 그것만 처리 (텍스트 부분 무시).
    if (onImageAttach) {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void insertAttachments(imageFiles);
        return;
      }
    }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const ta = e.currentTarget;
    const r = applyUrlPaste(ta.value, ta.selectionStart, ta.selectionEnd, text);
    if (r) {
      e.preventDefault();
      commitEdit(r);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (!onImageAttach) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    if (!onImageAttach) return;
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    e.preventDefault();
    void insertAttachments(files);
  }

  // 여러 이미지 동시 처리 — 모두 vault 에 저장 후 한 번에 commitEdit 으로 caret 위치에
  // 줄바꿈 join 해서 insert. 부분 실패 (slug 없음 등) 는 skip. 빈 결과면 no-op.
  // ta.value / selection 은 함수 진입 시점 snapshot — async 중 사용자가 typing 하면
  // 그 변경분이 묻힐 수 있지만 paste/drop 직후엔 보통 가만히 있어서 실측 race 위험 낮음.
  async function insertAttachments(files: File[]) {
    if (!onImageAttach) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const baseValue = ta.value;
    const paths: string[] = [];
    for (const file of files) {
      try {
        const p = await onImageAttach(file);
        if (p) paths.push(p);
      } catch (err) {
        console.error("image attach failed", err);
      }
    }
    if (paths.length === 0) return;
    const snippet = paths.map((p) => `![](${p})`).join("\n");
    const next = baseValue.slice(0, start) + snippet + baseValue.slice(end);
    const caret = start + snippet.length;
    commitEdit({ value: next, start: caret, end: caret });
  }

  // textarea 아래/우측 빈 영역 클릭 → textarea focus + caret 끝.
  // outer 자체 + 그 안 textarea-wrapper (textarea 아래 빈 영역) 둘 다 cover.
  // textarea / gutter marker / 그 안 자식은 자체 핸들러 (focus / line jump) 양보.
  function onContainerMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (target.closest("[data-gutter-marker]")) return;
    const el = textareaRef.current;
    if (!el) return;
    e.preventDefault();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setCaretLine(el.value.slice(0, end).split("\n").length - 1);
  }

  return (
    <div
      className={className ? `flex ${className}` : "flex"}
      onMouseDown={onContainerMouseDown}
      // flex 부모 (MeetingForm 의 mode container) 가 column 이면 grow 로 남은 높이 채움
      // — 빈 메모는 자연스럽게 viewport 끝까지 (스크롤 없음), 내용 길어지면 textarea
      // autoresize 가 자체 키워서 outer scroll 발생. shrink:0 으로 content 아래로
      // 줄어들지 X (textarea 클립 회피).
      style={{ flex: "1 0 auto", alignItems: "stretch", position: "relative" }}
    >
      <div
        className="select-none"
        style={{
          width: GUTTER_WIDTH,
          paddingRight: "4px", // active background 와 borderRight 사이 여백
          color: "var(--accent-ink)", // 편집 모드 signal — 보기 모드엔 gutter 자체 없음
          borderRight: "1px solid var(--line-2)",
          alignSelf: "flex-start", // outer flex stretch 무시 — 실제 줄 수까지만 border/marker 보임
        }}
      >
        {lineKinds.map((kind, i) => (
          <GutterMarker
            key={i}
            kind={kind}
            active={i === caretLine}
            // mirror 가 아직 측정 안 했거나 새 줄이면 LINE_HEIGHT_PX fallback.
            // wrap 된 줄은 측정한 px height 그대로 — textarea 의 visual line top 과 정렬.
            heightPx={lineHeights[i] ?? LINE_HEIGHT_PX}
            onClick={() => focusLine(i)}
            onAddTodo={
              kind.type === "checkbox" && onSendLineToInbox
                ? () => {
                    // 해당 줄의 raw text 만 추출 — 보기 모드 + 버튼과 동일 시그니처.
                    const lines = draft.split("\n");
                    const lineText = lines[i] ?? "";
                    if (lineText) onSendLineToInbox(lineText);
                  }
                : undefined
            }
          />
        ))}
      </div>
      <div className="relative flex-1">
        <textarea
          ref={(node) => {
            (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
            if (typeof externalTextareaRef === "function") {
              externalTextareaRef(node);
            } else if (externalTextareaRef) {
              (externalTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
            }
          }}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            const caret = e.target.selectionStart ?? v.length;
            // 단일 글자 입력으로 `->`/`=>` 완성 시 화살표 자동 치환 (코드 밖에서만).
            // paste·IME 오발화 방지로 "직전보다 1글자 늘었을 때"만.
            if (v.length === draft.length + 1) {
              const sub = applyArrowSubstitution(v, caret);
              if (sub) {
                lastArrowSubRef.current = { pos: sub.start, original: sub.original };
                commitEdit(sub); // draft/onChange/caret 일괄 처리 (useLayoutEffect)
                return;
              }
            }
            skipNextValueSyncRef.current = true;
            setDraft(v);
            onChange(v);
            updateCaretLine();
            updateSlashTrigger(v, caret);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onSelect={updateCaretLine}
          onKeyUp={updateCaretLine}
          onClick={updateCaretLine}
          onFocus={updateCaretLine}
          onBlur={() => {
            setCaretLine(null);
            onBlur?.();
          }}
          placeholder={placeholder}
          // text-base 제거 — font-size 도 outer container 의 className 으로 override 할 수
          // 있게 부모에서 inherit. 기본은 body 의 1rem 이라 MeetingForm 사용감 동일.
          className="block w-full resize-none bg-transparent outline-none"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            color: "var(--ink)",
            lineHeight: LINE_HEIGHT,
            // index.css 의 `.font-serif { font-weight: 600 }` base 룰 가로채기 — 일기처럼
            // wrapper 가 font-serif 인 경우에도 본문은 regular weight 유지. 메모장 (sans 400)
            // 과 일기 (serif 400) 본문 무게감 통일.
            fontWeight: 400,
            padding: 0,
            paddingLeft: TEXTAREA_PADDING_LEFT,
            paddingBottom: TEXTAREA_PADDING_BOTTOM,
            overflowY: "hidden",
            overflowX: "hidden", // wrap=soft 라 가로 scroll 발생 X — 명시
            overscrollBehavior: "none",
            wordBreak: "break-word", // 긴 영문 단어/URL 도 강제 wrap (CJK 는 어차피 char-단위)
            // drag 강조 — outline 은 inset 으로 textarea 박스 안쪽 (드롭 가능 영역
            // 정확 시각화). min-height 는 빈 메모 (1줄짜리) 에서 drop target 좁아 보이는
            // 통증 해결 — drag 중에만 8rem 으로 일시 확장, drag 끝나면 다시 autoresize.
            minHeight: isDraggingFiles ? "8rem" : undefined,
            outline: isDraggingFiles
              ? "2px dashed var(--accent)"
              : undefined,
            outlineOffset: isDraggingFiles ? "-2px" : undefined,
            backgroundColor: isDraggingFiles
              ? "var(--accent-soft)"
              : "transparent",
            borderRadius: isDraggingFiles ? "0.375rem" : undefined,
            transition:
              "min-height 120ms ease, outline-color 120ms ease, background-color 120ms ease",
          }}
          wrap="soft"
        />
        {/* hidden mirror — textarea 와 동일 width / font / padding 으로 source line 별
            wrap 된 actual visual height 측정. 자식 1개 = source line 1개 (\n 으로 split). */}
        <div
          ref={mirrorRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            visibility: "hidden",
            pointerEvents: "none",
            paddingLeft: TEXTAREA_PADDING_LEFT,
            paddingBottom: TEXTAREA_PADDING_BOTTOM,
            paddingTop: 0,
            paddingRight: 0,
            boxSizing: "border-box",
            fontFamily: "inherit",
            // textarea 가 outer container 에서 font-size 를 inherit 하도록 풀었으므로
            // mirror 도 inherit — 둘이 같은 font-size 여야 wrap measurement 가 맞음.
            fontSize: "inherit",
            // textarea 와 동일 weight — 다른 weight 면 같은 글자라도 너비가 달라 wrap 위치
            // 가 어긋남. textarea fontWeight 400 하드코딩에 맞춤.
            fontWeight: 400,
            lineHeight: LINE_HEIGHT,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "break-word",
          }}
        >
          {draft.split("\n").map((line, i) => (
            // 빈 줄도 한 줄 차지하도록 zero-width space.
            // pre-wrap 이라 trailing space 도 보존돼서 textarea wrap 동작과 일치.
            <div key={i} style={{ minHeight: LINE_HEIGHT }}>
              {line.length === 0 ? "​" : line}
            </div>
          ))}
        </div>
      </div>
      {slashState ? (() => {
        // popover 가 body 로 portal + position:fixed 이므로 viewport 좌표 계산 필요.
        // textarea getBoundingClientRect 기반 — 모달 overflow 등 ancestor clipping 우회.
        const ta = textareaRef.current;
        if (!ta) return null;
        const rect = ta.getBoundingClientRect();
        // textarea paddingLeft = 0.5rem (8px). 텍스트 원점이 popover 좌측.
        const desiredLeft = rect.left + 8;
        const lineBottom =
          rect.top + cumulativeHeight(lineHeights, slashState.slashLine + 1);
        const lineTop =
          rect.top + cumulativeHeight(lineHeights, slashState.slashLine);
        // popover height 추정 — Button sm + content ≈ 28px/option, py-1 컨테이너 = 8.
        // max-h-[400px] 가 상한. 실측 vs 추정 ±몇 px 차이만 — flip 시 cursor 줄 바로 위에 닿게.
        const opts = getSlashOptionsForFilter(slashState.filter);
        const estimateH = Math.min(400, opts.length * 28 + 8);
        // flip 기준 = textarea 의 가장 가까운 dialog (모달) bottom. 모달 없으면 viewport.
        // body portal 이라 popover 자체는 모달 밖 그려지지만 사용자 시야는 모달 안에 들어가야 자연스러움.
        const dialog = ta.closest('[role="dialog"]') as HTMLElement | null;
        const containerBottom = dialog
          ? dialog.getBoundingClientRect().bottom
          : window.innerHeight;
        const MARGIN = 8;
        // flip 결정엔 cushion margin 그대로, 위로 띄울 땐 cursor 줄 바로 위 (gap 0).
        const flipsUp = lineBottom + estimateH + MARGIN > containerBottom;
        const top = flipsUp ? lineTop - estimateH : lineBottom;
        // 좌측 viewport 밖 clamp — popover width 200px 고정.
        const POPOVER_W = 200;
        const left = Math.max(
          MARGIN,
          Math.min(desiredLeft, window.innerWidth - POPOVER_W - MARGIN),
        );
        return (
          <SlashCommandPopover
            filter={slashState.filter}
            selectedIndex={slashState.selectedIndex}
            onSelect={commitSlashOption}
            onClose={() => setSlashState(null)}
            anchorLeft={`${left}px`}
            anchorTop={`${Math.max(MARGIN, top)}px`}
          />
        );
      })() : null}
    </div>
  );
}

function cumulativeHeight(heights: number[], count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += heights[i] ?? LINE_HEIGHT_PX;
  }
  return sum;
}

function GutterMarker({
  kind,
  active,
  heightPx,
  onClick,
  onAddTodo,
}: {
  kind: LineKind;
  active: boolean;
  // mirror 측정 결과 — source line 이 wrap 되면 여러 visual line 의 합계 px.
  heightPx: number;
  onClick: () => void;
  // checkbox 라인 + onSendLineToInbox 둘 다 있을 때만 전달 — hover 시 글리프 swap.
  onAddTodo?: () => void;
}) {
  const label = labelForKind(kind);
  const depth =
    "depth" in kind && typeof kind.depth === "number" ? kind.depth : 0;
  const canAddTodo = !!onAddTodo;

  return (
    <div
      title={label || "이 줄로 이동"}
      onClick={onClick}
      data-gutter-marker
      // group/gutter + relative: + 버튼이 gutter 의 visual-left 왼쪽 (= 본문 wrapper
      //   px-6 padding 영역) 에 absolute 로 떠오름. 글리프는 그대로 보임.
      // before:* — invisible hit-area 24px 좌측 확장. gutter row 와 + 버튼 사이 갭에서
      //   마우스가 group-hover off 되던 깜빡임 차단.
      className="group/gutter relative flex cursor-pointer justify-center before:absolute before:left-[-1.5rem] before:top-0 before:h-full before:w-6 before:content-['']"
      style={{
        height: `${heightPx}px`,
        lineHeight: LINE_HEIGHT,
        color: active ? "var(--accent)" : undefined,
        // wrap 으로 여러 visual line 인 경우 glyph 는 첫 visual line 에 정렬.
        alignItems: "flex-start",
      }}
    >
      <span
        className="relative inline-flex items-center justify-center"
        style={{
          width: "1.5rem",
          height: LINE_HEIGHT, // glyph 자체는 한 visual line 높이 — 첫 줄에만.
          backgroundColor: active ? "var(--accent-soft)" : undefined,
          borderRadius: active ? "0.375rem" : undefined,
        }}
      >
        <KindGlyph kind={kind} />
        {depth > 0 ? (
          <span
            className="absolute font-mono text-[8px] font-semibold tabular-nums leading-none"
            style={{
              right: "-1px",
              bottom: "-1px",
              color: "var(--faint)",
            }}
          >
            {depth}
          </span>
        ) : null}
      </span>
      {canAddTodo ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddTodo!();
          }}
          title="할 일로 추가"
          aria-label="할 일로 추가"
          // gutter 의 좌측 외부 (본문 wrapper 의 px-6 padding 영역) — 보기 모드와 동일 위치.
          // minHeight: 0 은 글로벌 `button { min-height: 44px }` (index.css) 우회.
          className="absolute opacity-0 transition-opacity hover:opacity-100 group-hover/gutter:opacity-100 focus-visible:opacity-100"
          style={{
            left: "-1.5rem",
            top: "5px",
            width: "1rem",
            height: "1rem",
            minHeight: 0,
            padding: 0,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.25rem",
            color: "var(--sub)",
          }}
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

// 이어짐 줄 표시 — 위 항목과 시각적으로 묶이는 dotted line.
// variant "vertical" = 중간, "corner" = 마지막 (└ 모양).
function ContinuationGlyph({ variant }: { variant: "vertical" | "corner" }) {
  return (
    <svg
      width={20}
      height={26}
      viewBox="0 0 20 26"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <line
        x1="10"
        y1="0"
        x2="10"
        y2={variant === "corner" ? 14 : 26}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="1.5 3"
      />
      {variant === "corner" ? (
        <path
          d="M 10 14 Q 10 18 14 18"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="1.5 3"
        />
      ) : null}
    </svg>
  );
}

function KindGlyph({ kind }: { kind: LineKind }) {
  const isContinuation =
    "continuation" in kind && kind.continuation === true;
  if (isContinuation) {
    const isLast =
      "lastContinuation" in kind && kind.lastContinuation === true;
    return <ContinuationGlyph variant={isLast ? "corner" : "vertical"} />;
  }
  switch (kind.type) {
    case "paragraph":
    case "empty":
      return null;
    case "heading":
      return (
        <span className="font-mono text-[10px] font-semibold">
          H{kind.level}
        </span>
      );
    case "bullet":
      return <List className="h-3.5 w-3.5" />;
    case "ordered":
      if (typeof kind.renderedNumber === "number") {
        return (
          <span className="font-mono text-[10px] font-semibold tabular-nums">
            {kind.renderedNumber}.
          </span>
        );
      }
      return <ListOrdered className="h-3.5 w-3.5" />;
    case "checkbox":
      return <CheckSquare className="h-3.5 w-3.5" />;
    case "quote":
      return <Quote className="h-3.5 w-3.5" />;
    case "code-fence":
    case "code-block":
    case "code-indent":
      return <Code className="h-3.5 w-3.5" />;
    case "hr":
      return <Minus className="h-3.5 w-3.5" />;
    case "table":
      return <Table className="h-3.5 w-3.5" />;
    case "link-def":
      return <Link className="h-3.5 w-3.5" />;
  }
}
