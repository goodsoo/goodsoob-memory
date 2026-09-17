import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Copy,
  Check,
  Undo2,
  Redo2,
  Pencil,
  X,
  Calendar as CalendarIcon,
  Clock,
  Users,
  AlertCircle,
  Sparkles,
  Upload,
} from "lucide-react";

import {
  consumeJustCreatedMeetingUid,
  useMeeting,
  useMeetings,
  useUpdateMeeting,
  useDeleteMeeting,
  useMoveMeeting,
  useTogglePinMeeting,
} from "../../hooks/useMeetings";
import { useStateHistory } from "../../hooks/useStateHistory";
import type { MeetingUpdate } from "../../api/meetings";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { SaveIndicator } from "../common/SaveIndicator";
import { PageHeaderBar } from "../common/PageHeaderBar";
import { Kbd } from "../common/Kbd";
import { EmptyState } from "../common/EmptyState";
import { SummaryModal } from "./SummaryModal";
import { MeetingActionMenu } from "./MeetingActionMenu";
import { ModeChip } from "../common/ModeChip";
import { useToast } from "../Toast";
import { AttendeeTagInput } from "./AttendeeTagInput";
import { SourceBodyEditor } from "./SourceBodyEditor";
import { FindBar } from "./FindBar";
import { findAllMatches, replaceAllInText } from "../../lib/findMatches";
import { measureCaretTop } from "../../lib/textareaMeasure";
import { useVault } from "../../lib/vault/useVault";
import { saveAttachment } from "../../lib/attachments";
import { MarkdownView } from "./MarkdownView";
import { TaskAddModal } from "../tasks/TaskAddModal";
import { MoveFolderModal } from "./MoveFolderModal";
import { MeetingExportModal } from "./MeetingExportModal";
import type { TaskInsert, TaskPriority } from "../../api/tasks";
import { extractTasks } from "../../lib/vault/tasks";
import { useViewMode } from "../../hooks/useViewMode";
import { isTauri } from "../../lib/isTauri";
import { formatError } from "../../lib/errors";
import { TitleConflictError } from "../../lib/vault/scan";
import { OfflineCacheMissError } from "../../lib/vault/readCache";
import { formatDisplayDate } from "../../lib/dates";
import { LooseDateInput } from "../common/LooseDateInput";
import { LooseTimeInput } from "../common/LooseTimeInput";
import { Tabs } from "../../ds/Tabs";

// 파일시스템 + 옵시디안 link syntax 금지 문자. title input commit 시 검사.
const TITLE_UNSAFE_RE = /[/\\:*?"<>|#^[\]]/;

type Props = {
  meetingId: string;
  onBack: () => void;
  // 삭제 직후 다음 메모 선택. caller 가 신선한 nextUid 받음 — null 이면 onBack 으로 fallback.
  // pre-capture 가 caller 책임 (await 사이 list cache 가 invalidate 되므로).
  onAfterDelete?: (nextUid: string | null) => void;
  // 삭제 직전 다음 메모 uid 계산 (사이드바 정렬 / 폴더 위계 적용). 미제공 시
  // raw list 의 idx+1/-1 fallback.
  computeNextAfterDelete?: (uid: string) => string | null;
};

// title 은 history 미참여 (별도 commitTitle 가 직접 mutation).
type MetaDoc = {
  date: string;
  time: string;
  attendees: string;
};

// 전체 메모 도큐먼트 = 1 history stack (옵시디안/notion 패턴).
// __source = 마지막 set 의 출처 ("body"/"transcript"/"summary"/"meta:*"). undo/redo 시
// 자동으로 그 탭으로 setActiveTab 하는 UX 용 metadata. docsEqual / docToPatch 에서 무시.
type DocSnapshot = {
  body: string;
  transcript: string;
  summary: string; // V0.7.3 — 마크다운 텍스트 통째. 본문과 동일 모델.
  meta: MetaDoc;
  __source?: string;
};

function trimNewlines(s: string): string {
  return s.replace(/^\n+/, "").replace(/\n+$/, "");
}

function metasEqual(a: MetaDoc, b: MetaDoc): boolean {
  return a.date === b.date && a.time === b.time && a.attendees === b.attendees;
}

function metaToPatch(m: MetaDoc): MeetingUpdate {
  return {
    date: m.date || null,
    time: m.time.trim() || null,
    attendees: m.attendees.trim() || null,
  };
}

function docsEqual(a: DocSnapshot, b: DocSnapshot): boolean {
  return (
    a.body === b.body &&
    a.transcript === b.transcript &&
    trimNewlines(a.summary) === trimNewlines(b.summary) &&
    metasEqual(a.meta, b.meta)
  );
}

function docToPatch(d: DocSnapshot): MeetingUpdate {
  return {
    content: d.body,
    transcript: d.transcript || null,
    summary: d.summary || null,
    ...metaToPatch(d.meta),
  };
}


type ActiveTab = "body" | "transcript" | "summary";

// 마지막 활성 탭 — 메모 전체 공통 (메모별 분리 X). 메모 A 의 음성 기록 탭에서
// 메모 B 로 전환하면 B 도 음성 기록 탭으로 열림 (옵시디안의 "탭은 뷰 상태" 모델).
// 페이지 전환으로 unmount/mount 돼도 살아남도록 모듈 레벨. 새로고침 시 초기화.
let activeTabGlobal: ActiveTab = "body";
// 메모 + 탭 별 scroll 위치 기억 (`${meetingId}:${tab}` → scrollTop). 탭 전환/페이지
// 전환 시 outgoing 탭의 위치 저장 + incoming 탭의 위치 복원. 새로고침 시 초기화.
const SCROLL_CACHE = new Map<string, number>();

export function MeetingForm({
  meetingId,
  onBack,
  onAfterDelete,
  computeNextAfterDelete,
}: Props) {
  const { data, isLoading, error, refetch } = useMeeting(meetingId);
  const meetingsQ = useMeetings();
  const updateMutation = useUpdateMeeting(meetingId);
  const deleteMutation = useDeleteMeeting();
  const togglePinMutation = useTogglePinMeeting();
  const moveMutation = useMoveMeeting();
  const [moveOpen, setMoveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [viewMode, setViewMode] = useViewMode();
  const { adapter } = useVault();
  const toast = useToast();

  const attendeeSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetingsQ.data ?? []) {
      if (!m.attendees || m.attendees.length === 0) continue;
      for (const tag of m.attendees) set.add(tag);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [meetingsQ.data]);


  // 데이터 도착 전엔 cacheKey undefined → cache 참여 X. 데이터 도착 시
  // undefined → defined transition 으로 initial 적용. 메모 전환 시
  // cacheKey 가 바뀌면서 이전 메모의 stack state 가 모듈 캐시에 보존됨.
  //
  // V0.7.1 title-as-filename 모델: title 변경 = file path rename. 그래서 cacheKey
  // 는 path (`data.id`) 가 아니라 영구 식별자 uid 기반 — 제목 바뀌어도 history 유지.
  const uid = data?.uid;
  const initialBody = data?.content ?? "";
  const initialTranscript = data?.transcript ?? "";

  // 본문 textarea 안 이미지 paste/drop → vault `notes/_attachments/{uid}/{N}.{ext}`
  // 저장 후 `![](path)` insert. slug 는 영구 식별자 uid — 메모 title 은 자주 바뀌니
  // title 기반 폴더는 흩어짐/orphan 비용. V0.7.1 의 "모든 client cache key 는 uid 기반"
  // 정책과 정합. Finder 가독성은 떨어지지만 본인 빌더 모드 + grep 으로 역추적 가능.
  const onImageAttach = useCallback(
    async (file: File): Promise<string | null> => {
      if (!uid) return null;
      try {
        return await saveAttachment(adapter, {
          baseDir: "notes",
          slug: uid,
          file,
        });
      } catch (err) {
        console.error("image attach failed", err);
        return null;
      }
    },
    [adapter, uid],
  );
  const initialSummary = data?.summary ?? "";
  const initialMeta = useMemo<MetaDoc>(
    () => ({
      date: data?.date ?? "",
      time: data?.time ?? "",
      attendees: data?.attendees ? data.attendees.join(", ") : "",
    }),
    [data],
  );

  const initialDoc = useMemo<DocSnapshot>(
    () => ({
      body: initialBody,
      transcript: initialTranscript,
      summary: initialSummary,
      meta: initialMeta,
    }),
    [initialBody, initialTranscript, initialSummary, initialMeta],
  );

  // 메모 전체 = 1 history stack. body 키타이프 / transcript / summary edit /
  // date·time·attendees commit 모두 하나의 timeline. Cmd+Z 는 focus 무관 마지막
  // 변경 undo (옵시디안/notion 패턴). 제목은 history 미참여 — commitTitle 직접 mutation.
  const docHistory = useStateHistory<DocSnapshot>({
    initial: initialDoc,
    cacheKey: uid ? `${uid}:doc` : undefined,
    commitMs: 1000,
    isEqual: docsEqual,
    onCommit: (d) => updateMutation.mutate(docToPatch(d)),
  });

  const doc = docHistory.value;
  const body = doc.body;
  const transcript = doc.transcript;
  const summary = doc.summary;
  const meta = doc.meta;

  // history entry boundary 추적 — 직전 set 의 source 와 다르면 flush 먼저
  // (= 직전 source 의 pending 을 별도 entry 로 마감, 새 entry 시작).
  const lastSourceRef = useRef<string | null>(null);
  function setDoc(source: string, next: DocSnapshot, immediate = false) {
    if (lastSourceRef.current !== null && lastSourceRef.current !== source) {
      docHistory.flush();
    }
    lastSourceRef.current = source;
    docHistory.set({ ...next, __source: source });
    if (immediate) docHistory.flush();
  }

  // undo/redo 시 doc.__source 보고 자동 탭 전환 (옵시디안/notion 처럼 변경 시점 탭으로).
  // meta:* 는 본문 탭 내부 영역이라 body 로 라우팅. typing 중에도 effect 가 fire 되지만
  // 이미 그 탭에 있으니 no-op.


  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  // 요약 흐름 — 두 진입점 모두 모달로 분리 (자동 호출 / 외부 paste).
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  async function copyToastMessage(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToast(id);
      setTimeout(() => setCopiedToast((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // clipboard 권한 없으면 silent — 사용자가 다시 누르면 됨
    }
  }
  const titleInputRef = useRef<HTMLInputElement>(null);
  // ESC revert 직후 onBlur 가 commitTitle 다시 발사하는 것 차단용.
  const skipNextTitleCommit = useRef(false);

  // title 은 history 미참여 — draft + blur/Enter 시 직접 mutation.
  const initialTitle = data?.title ?? "";
  const [titleDraft, setTitleDraft] = useState<string>(initialTitle);
  const [attendeesDraft, setAttendeesDraft] = useState<string>(
    () => meta.attendees,
  );
  useEffect(() => {
    // 사용자가 typing 중 (input focus) 이면 server value 로 덮어쓰기 회피.
    if (document.activeElement === titleInputRef.current) return;
    setTitleDraft(initialTitle);
  }, [initialTitle]);
  useEffect(() => {
    // 외부 meta.attendees 가 바뀌면 draft 동기화 (다른 mutation/sync). 의도된 sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttendeesDraft(meta.attendees);
  }, [meta.attendees]);

  async function commitTitle() {
    if (skipNextTitleCommit.current) {
      skipNextTitleCommit.current = false;
      return;
    }
    const trimmed = titleDraft.trim();
    const next = trimmed === "" ? (initialTitle || "untitled") : trimmed;
    if (next !== titleDraft) setTitleDraft(next);
    if (next === initialTitle) return;
    if (TITLE_UNSAFE_RE.test(next)) {
      setActionError(
        `제목에 다음 문자 사용 불가: / \\ : * ? " < > | # ^ [ ]\n계속 수정하거나 ESC 로 원래 제목 유지하세요.`,
      );
      requestAnimationFrame(() => titleInputRef.current?.focus());
      return;
    }
    try {
      await updateMutation.mutateAsync({ title: next });
    } catch (err) {
      if (err instanceof TitleConflictError) {
        setActionError(
          `이미 같은 제목의 메모가 있어요: "${next}"\n계속 수정하거나 ESC 로 원래 제목 유지하세요.`,
        );
        requestAnimationFrame(() => titleInputRef.current?.focus());
      }
    }
  }

  // meta 변경은 명시 commit (blur/Enter/tag 추가) — source 별로 분리 entry,
  // immediate=true 로 즉시 history append.
  function commitDate(next: string) {
    if (next === meta.date) return;
    setDoc("meta:date", { ...doc, meta: { ...meta, date: next } }, true);
  }

  function commitTime(next: string) {
    if (next === meta.time) return;
    setDoc("meta:time", { ...doc, meta: { ...meta, time: next } }, true);
  }

  function commitAttendees(next: string) {
    setAttendeesDraft(next);
    if (next.trim() === meta.attendees.trim()) return;
    setDoc("meta:attendees", { ...doc, meta: { ...meta, attendees: next } }, true);
  }
  const [activeTab, setActiveTabState] = useState<ActiveTab>(
    () => activeTabGlobal,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  function setActiveTab(t: ActiveTab) {
    activeTabGlobal = t;
    setActiveTabState(t);
  }

  // ── 탭 내 찾기 (Cmd+F) ──────────────────────────────────────────────
  // 현재 탭(본문/음성기록/요약)에서 검색. 편집 모드는 textarea 선택(inactive 하이라이트),
  // 보기 모드는 렌더 DOM Range 의 client rect 를 떠 오버레이 박스로 강조 + 컨테이너 스크롤.
  // (보기 모드에서 문서 selection 은 focus 가 입력창이면 페인트 안 되고 user-select:none
  // 영역도 있어 못 씀.) 두 모드 모두 focus 는 find 입력창에 유지 → Enter 연타 순회, 입력
  // 오염 X. Enter/↓=다음, Shift+Enter/↑=이전, Cmd+G/Cmd+Shift+G 동일. window keydown + ref API.
  //
  // 보기 모드는 raw 마크다운이 아니라 "화면에 보이는 텍스트"(textContent)를 검색해야
  // 사용자 기대와 맞음 (`**굵게**` → "굵게"). 그래서 매치 계산을 mode 별로 분기.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findActive, setFindActive] = useState(-1); // 0-based, -1 = 아직 미점프
  const [findMatches, setFindMatches] = useState<number[]>([]);
  // 보기 모드 현재 매치 하이라이트 박스 (contentWrapper 기준 좌표, 줄당 1개).
  // 문서 selection 은 focus 가 find 입력창에 있으면 페인트가 안 돼(+ user-select:none
  // 영역도 있음) 오버레이 박스로 그린다.
  const [findHitRects, setFindHitRects] = useState<
    { top: number; left: number; width: number; height: number }[]
  >([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

  const findText =
    activeTab === "body"
      ? body
      : activeTab === "transcript"
        ? transcript
        : summary;

  // 보기 모드 검색 대상 = data-find-content 안 렌더 텍스트. 활성 탭의 것 1개만 mount.
  function findContentEl(): HTMLElement | null {
    return (
      scrollContainerRef.current?.querySelector<HTMLElement>(
        "[data-find-content]",
      ) ?? null
    );
  }
  function findSearchText(): string {
    if (viewMode === "edit") return findText;
    return findContentEl()?.textContent ?? "";
  }

  // 매치는 DOM(보기 모드 textContent)에 의존하므로 layout effect 에서 계산해 state 보관.
  // findText 를 dep 에 둬 편집 중 본문 변경 시에도 재계산. 닫혀있거나 빈 query 면 비움.
  useLayoutEffect(() => {
    // DOM(보기 모드 textContent)을 읽어 state 로 동기화 — 정당한 effect→state 케이스.
    // query/탭/모드/본문 변경 시 이전 하이라이트 박스도 비움 (다음 점프에서 재계산).
    /* eslint-disable react-hooks/set-state-in-effect */
    setFindHitRects([]);
    if (!findOpen || !findQuery) {
      setFindMatches([]);
      return;
    }
    setFindMatches(findAllMatches(findSearchText(), findQuery, findCase));
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, findCase, activeTab, viewMode, findText]);

  function setFindQueryAndReset(v: string) {
    setFindQuery(v);
    setFindActive(-1);
  }
  function toggleFindCase() {
    setFindCase((c) => !c);
    setFindActive(-1);
  }

  // 컨테이너 기준 매치 top px 로 스크롤 (화면 40% 지점).
  function scrollContainerTo(topInContainer: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: Math.max(0, topInContainer - container.clientHeight * 0.4),
      behavior: "smooth",
    });
  }

  // 편집 모드: textarea 선택 (focus 안 옮김 → inactive selection 회색 하이라이트).
  function selectMatchInTextarea(start: number) {
    const container = scrollContainerRef.current;
    const ta = container?.querySelector("textarea");
    if (!(ta instanceof HTMLTextAreaElement) || !container) return;
    ta.setSelectionRange(start, start + findQuery.length);
    const caretTop = measureCaretTop(ta, start);
    const taTop =
      ta.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    scrollContainerTo(taTop + caretTop);
  }

  // 보기 모드: 렌더 텍스트의 char offset → text node Range 로 매핑 → client rect 들을
  // contentWrapper 기준 좌표로 변환해 오버레이 박스로 그린다 (selection 페인트 불안정 회피).
  function selectMatchInView(start: number) {
    const root = findContentEl();
    const wrapper = contentWrapperRef.current;
    const container = scrollContainerRef.current;
    if (!root || !wrapper || !container) return;
    const end = start + findQuery.length;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let startNode: Text | null = null;
    let startOff = 0;
    let endNode: Text | null = null;
    let endOff = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const len = t.data.length;
      if (!startNode && start < acc + len) {
        startNode = t;
        startOff = start - acc;
      }
      if (startNode && end <= acc + len) {
        endNode = t;
        endOff = end - acc;
        break;
      }
      acc += len;
    }
    if (!startNode || !endNode) return;
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return;
    const wrapRect = wrapper.getBoundingClientRect();
    setFindHitRects(
      rects.map((r) => ({
        top: r.top - wrapRect.top,
        left: r.left - wrapRect.left,
        width: r.width,
        height: r.height,
      })),
    );
    const cRect = container.getBoundingClientRect();
    scrollContainerTo(container.scrollTop + (rects[0].top - cRect.top));
  }

  function scrollToMatch(i: number) {
    const start = findMatches[i];
    if (start == null) return;
    if (viewMode === "edit") selectMatchInTextarea(start);
    else selectMatchInView(start);
  }

  function gotoMatch(nextIdx: number) {
    const n = findMatches.length;
    if (n === 0) return;
    const i = ((nextIdx % n) + n) % n;
    setFindActive(i);
    scrollToMatch(i);
  }
  // 미점프(-1) 상태에선 다음=첫 매치, 이전=마지막 매치.
  function findNext() {
    gotoMatch(findActive < 0 ? 0 : findActive + 1);
  }
  function findPrev() {
    gotoMatch(findActive < 0 ? findMatches.length - 1 : findActive - 1);
  }

  function openFind() {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }

  function closeFind() {
    setFindOpen(false);
    setFindHitRects([]);
  }

  // ── 바꾸기 (FindBar ▸ 펼침) ─────────────────────────────────────────
  // 편집 모드 세 탭(본문/음성기록/요약) textarea 의 raw 텍스트만 치환 대상.
  // 보기 모드는 바꾸기 줄 비활성 (UI 가 막고, 함수도 viewMode 가드). 치환은 기존
  // setDoc 경로(immediate flush)로 docHistory 에 단일 entry 로 올려 Cmd+Z 한 번에 undo.
  const [replaceExpanded, setReplaceExpanded] = useState(false);
  const [replaceText, setReplaceText] = useState("");

  // 활성 탭의 텍스트를 통째로 교체 — 탭별 source 로 분리해 undo 가 그 탭으로 라우팅.
  // immediate=true 라 직전 typing pending 을 마감하고 치환을 자기 entry 로 둠.
  function writeActiveTabText(next: string) {
    if (activeTab === "transcript")
      setDoc("transcript:replace", { ...doc, transcript: next }, true);
    else if (activeTab === "summary")
      setDoc("summary:replace", { ...doc, summary: next }, true);
    else setDoc("body:replace", { ...doc, body: next }, true);
  }

  // 현재 매치 1개 치환 → 같은 자리 이후 다음 매치로 이동.
  function replaceCurrent() {
    if (viewMode !== "edit") return;
    const matches = findMatches;
    if (matches.length === 0 || !findQuery) return;
    if (findActive < 0) {
      // 미점프면 먼저 첫 매치로 — 한 번 더 눌러 치환.
      gotoMatch(0);
      return;
    }
    const i = ((findActive % matches.length) + matches.length) % matches.length;
    const start = matches[i];
    const text = findText;
    const next =
      text.slice(0, start) + replaceText + text.slice(start + findQuery.length);
    writeActiveTabText(next);
    // 새 텍스트에서 매치 재계산 — 치환 지점 이후 첫 매치로 이동 (없으면 처음으로 wrap).
    const after = findAllMatches(next, findQuery, findCase);
    if (after.length === 0) {
      setFindActive(-1);
      return;
    }
    let nextIdx = after.findIndex((m) => m >= start + replaceText.length);
    if (nextIdx < 0) nextIdx = 0;
    setFindActive(nextIdx);
    // textarea 값이 re-render 된 뒤 선택/스크롤 (findMatches state 갱신 전이라 직접 좌표 사용).
    requestAnimationFrame(() => selectMatchInTextarea(after[nextIdx]));
  }

  // 전체 치환 — 겹치지 않는 매치를 모두 교체. 단일 history entry → Cmd+Z 한 번에 undo.
  function replaceAll() {
    if (viewMode !== "edit" || !findQuery) return;
    const text = findText;
    const next = replaceAllInText(text, findQuery, replaceText, findCase);
    if (next === text) return;
    writeActiveTabText(next);
    setFindActive(-1);
    setFindHitRects([]);
  }

  // window keydown 핸들러가 매 렌더 closure 를 안 잡도록 ref 로 최신 API 전달
  // (listener 는 빈 deps 로 한 번만 등록 — 본문 typing 마다 재등록 폭주 회피).
  // ref 갱신은 deps 없는 effect 에서 (렌더 중 ref 변경 회피). keydown 은 항상
  // paint 후라 최신값을 본다.
  const findApiRef = useRef<{
    open: () => void;
    advance: (d: number) => void;
    close: () => void;
    isOpen: boolean;
  }>({ open: () => {}, advance: () => {}, close: () => {}, isOpen: false });
  useEffect(() => {
    findApiRef.current = {
      open: openFind,
      advance: (d: number) => (d > 0 ? findNext() : findPrev()),
      close: closeFind,
      isOpen: findOpen,
    };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      const api = findApiRef.current;
      if (cmd && !e.altKey && !e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        api.open();
        return;
      }
      if (api.isOpen && cmd && e.code === "KeyG") {
        e.preventDefault();
        api.advance(e.shiftKey ? -1 : 1);
        return;
      }
      // textarea 등 find 입력창 밖에서 Esc — 찾기 닫기 (입력창 안 Esc 는 FindBar 처리).
      if (api.isOpen && e.key === "Escape" && document.activeElement !== findInputRef.current) {
        api.close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalPrefill, setTaskModalPrefill] = useState<
    Partial<TaskInsert>
  >({});

  // beforeunload — 페이지 닫기 직전 모든 pending 변경 flush.
  // unmount 시 cleanup 은 useStateHistory 가 자체 처리하므로 여기선 listener 정리만.
  useEffect(() => {
    function onBeforeUnload() {
      docHistory.flush();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [docHistory]);

  // 탭/메모 전환 후 layout 직후 — incoming 탭의 scroll 위치 복원 (없으면 0).
  // content mount 직후엔 textarea auto-resize 등으로 height 가 정해지지 않아
  // scrollTop set 이 cap 될 수 있음. immediate + next frame 두 번 set 으로 안전.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const saved = SCROLL_CACHE.get(`${meetingId}:${activeTab}`) ?? 0;
    el.scrollTop = saved;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
    return () => cancelAnimationFrame(raf);
  }, [meetingId, activeTab]);

  // undo/redo 시 변경되는 영역의 탭으로 자동 전환.
  //   undo → from.__source (= 되돌려지는 변경의 출처)
  //   redo → to.__source   (= 적용되는 변경의 출처)
  // 둘 다 "변경이 일어나는" 탭으로 가는 일관 규칙.
  function routeToSource(src: string | undefined) {
    if (!src) return;
    // startsWith 로 "transcript", "transcript:replace" 등 변형까지 같은 탭으로.
    if (src.startsWith("transcript")) setActiveTab("transcript");
    else if (src.startsWith("summary")) setActiveTab("summary");
    else setActiveTab("body"); // "body" 또는 "meta:*"
  }

  // 방금 만든 메모면 본문 탭으로 전환 + title input 자동 focus + select all —
  // 새 메모는 바로 제목 타이핑 → 본문 작성으로 이어지도록.
  // 편집 모드 강제는 useCreateMeeting 가 생성 시점에 viewMode 를 edit 로 써둠 →
  // 이 remount 의 useViewMode 초기값이 edit (mount 후 setViewMode 는 race 라 안 씀).
  useEffect(() => {
    if (consumeJustCreatedMeetingUid(meetingId)) {
      setActiveTab("body");
      // mount 직후 ref attach 되도록 microtask 한 tick 미룸
      requestAnimationFrame(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      });
    }
  }, [meetingId]);

  // ESC: 활성 input/textarea/contenteditable 의 focus 제거. 제목/날짜/시간/참석자는
  // 각자 onKeyDown 의 Esc 핸들러가 먼저 발동해 draft → 이전값 revert + 자체 blur.
  // 본문/음성 기록 textarea 는 값 유지 + 여기서 blur 만.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const a = document.activeElement as HTMLElement | null;
      if (!a) return;
      const tag = a.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || a.isContentEditable) {
        a.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 단축키:
  //   Cmd/Ctrl+Z/Y/Shift+Z = docHistory undo/redo (전체 도큐먼트 timeline. 제목 제외).
  //     focus 가 제목 input 이면 native input undo 사용 (preventDefault X).
  //   Opt+Tab / Opt+Shift+Tab = sub-tab cycle 본문→음성기록→요약 (textarea/input 무관).
  //   Cmd+Shift+E = 모든 탭 편집/보기 토글 (Cmd+E inline-code wrap 충돌 회피).
  useEffect(() => {
    function isInTitleInput(): boolean {
      return document.activeElement === titleInputRef.current;
    }

    function onKeyDown(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const isUndo = cmd && !e.shiftKey && !e.altKey && k === "z";
      const isRedo =
        (cmd && !e.altKey && k === "y") ||
        (cmd && e.shiftKey && !e.altKey && k === "z");
      // 제목 input focus 면 native input undo 통과 (title 은 history 미참여).
      if ((isUndo || isRedo) && isInTitleInput()) return;
      if (isUndo) {
        e.preventDefault();
        const t = docHistory.undo();
        if (t) routeToSource((t.from as DocSnapshot).__source);
        return;
      }
      if (isRedo) {
        e.preventDefault();
        const t = docHistory.redo();
        if (t) routeToSource((t.to as DocSnapshot).__source);
        return;
      }
      // Opt+Tab — sub-tab cycle (textarea/input focus 무관, Opt 없는 Tab=indent 는 보존).
      // 본문→음성기록→요약→본문. Shift 동반 시 역순.
      if (e.altKey && !cmd && e.key === "Tab") {
        e.preventDefault();
        const order: ActiveTab[] = ["body", "transcript", "summary"];
        const idx = order.indexOf(activeTab);
        const dir = e.shiftKey ? -1 : 1;
        setActiveTab(order[(idx + dir + order.length) % order.length]);
        return;
      }
      // Cmd+Shift+E — 모든 탭에서 편집/보기 토글 (ModeChip 과 동일, viewMode 공유).
      // SourceBodyEditor 의 Cmd+E (inline-code wrap) 충돌 회피로 Shift 동반.
      // 음성 기록 보기 모드 = 읽기 전용 + 참석자 하이라이트 (마크다운 렌더 X).
      if (cmd && e.shiftKey && !e.altKey && e.code === "KeyE") {
        e.preventDefault();
        setViewMode(viewMode === "edit" ? "view" : "edit");
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // routeToSource / setActiveTab 은 의도적으로 dep 제외 — listener 매 typing 마다
    // re-register 폭주 회피 (안의 클로저는 ref 통해 최신 값 사용).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docHistory, activeTab, viewMode, setViewMode]);

  async function handleDelete() {
    if (!data) return;
    if (!window.confirm("이 메모를 휴지통으로 옮길까요?")) return;
    // 삭제 전 옛 list 에서 다음 메모 capture. mutate 의 onSuccess 가 cache 의 list
    // 에서 deleted 를 즉시 filter 하므로 await 후엔 idx 가 무의미 — pre-capture 필수.
    // caller 가 사이드바 정렬/폴더 위계 알아서 결정 (computeNextAfterDelete). 미제공
    // 시 raw list idx+1/-1 fallback.
    let nextUid: string | null;
    if (computeNextAfterDelete) {
      nextUid = computeNextAfterDelete(data.uid);
    } else {
      const list = meetingsQ.data ?? [];
      const idx = list.findIndex((m) => m.uid === data.uid);
      nextUid =
        idx >= 0 ? (list[idx + 1]?.uid ?? list[idx - 1]?.uid ?? null) : null;
    }
    try {
      await deleteMutation.mutateAsync(data.uid);
      if (onAfterDelete) {
        onAfterDelete(nextUid);
      } else {
        onBack();
      }
    } catch (e) {
      setActionError(formatError(e));
    }
  }

  function retrySave() {
    if (updateMutation.isPending) return;
    updateMutation.mutate({
      title: titleDraft.trim() || initialTitle || "untitled",
      ...docToPatch(doc),
    });
  }

  if (error) {
    const isOfflineMiss = error instanceof OfflineCacheMissError;
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <EmptyState
          icon={
            <AlertCircle
              className="h-12 w-12"
              style={{ color: isOfflineMiss ? "var(--text-muted)" : "var(--down)" }}
              strokeWidth={1.25}
            />
          }
          title={isOfflineMiss ? "오프라인 상태입니다" : "메모를 불러오지 못했습니다"}
          description={
            isOfflineMiss
              ? "이 노트는 온라인에서 불러올 수 있습니다."
              : "잠시 후 다시 시도하세요."
          }
          action={
            isOfflineMiss ? undefined : (
              <Button variant="primary" onClick={() => void refetch()}>
                다시 시도
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="space-y-4" aria-hidden>
          <div className="h-10 w-48 animate-pulse rounded" style={{ backgroundColor: "var(--surface)" }} />
          <div className="h-6 w-32 animate-pulse rounded" style={{ backgroundColor: "var(--surface)" }} />
          <div className="h-64 animate-pulse rounded" style={{ backgroundColor: "var(--surface)" }} />
        </div>
      </div>
    );
  }

  const hasAnySummary = summary.trim().length > 0;

  // 미저장 변경 여부 — memory state vs query data (optimistic update 후엔 sync).
  // typing 직후 ~ commit timer (1초) 까진 true, optimistic update 시점에 false.
  // body/transcript/summary 는 disk write 시 앞뒤 newline trim 되므로 비교도 normalize.
  // attendees 는 textarea string vs disk-roundtrip 의 ", " join 차이 회피 위해 parseAttendees 로 array 비교.
  // title 은 별도 (titleDraft) — typing 중 일치 안 해도 spinner 표시 X (blur/Enter 만 mutation).
  // meta 4 field 는 draft 라 typing 중 spinner X — commit 후 initialMeta 갱신.
  const hasUnsavedChange =
    trimNewlines(body) !== trimNewlines(initialBody) ||
    trimNewlines(transcript) !== trimNewlines(initialTranscript) ||
    trimNewlines(summary) !== trimNewlines(initialSummary);

  const meetingForCopy = {
    title: titleDraft.trim() || initialTitle || null,
    date: meta.date || null,
    time: meta.time || null,
    attendees: meta.attendees || null,
    body,
    transcript,
    summary,
  };

  // 요약 적용 — 두 모달 공용 콜백. summary 텍스트 통째 교체 (단일 history entry).
  // 기존 내용은 덮어쓰지만 Cmd+Z 로 복원 가능 (docHistory 통합 stack).
  function applySummaryFromModal(next: string) {
    setDoc("summary:apply", { ...doc, summary: next }, true);
  }

  const summaryDisabled =
    (body ?? "").trim().length === 0 && (transcript ?? "").trim().length === 0;

  // "요약하기" 클릭 — 메모·음성 기록 둘 다 비면 모달 대신 하단 안내 토스트.
  // 버튼을 비활성(disabled)으로 두면 클릭 자체가 안 먹어 이유를 모르므로, 클릭은
  // 받되 시각만 흐리게 (aria-disabled) 하고 안내를 띄움.
  function handleSummaryClick() {
    if (summaryDisabled) {
      toast.show("메모나 음성 기록을 먼저 작성하면 요약할 수 있습니다.", {
        kind: "info",
      });
      return;
    }
    setSummaryModalOpen(true);
  }

  const summaryPromptInput = {
    title: titleDraft.trim() || initialTitle || null,
    date: meta.date || null,
    time: meta.time || null,
    attendees: meta.attendees || null,
    content: body,
    transcript: transcript || null,
  };

  // 탭별 액션 — 헤더 우측 편집 토글 왼쪽에 모음 (sticky 라 스크롤해도 닿음).
  // 음성 기록 업로드는 편집 모드만, 요약 자동요약·붙여넣기는 항상.
  const showUploadAction = activeTab === "transcript" && viewMode === "edit";
  const showSummaryActions = activeTab === "summary";
  const hasTabActions = showUploadAction || showSummaryActions;

  // 활성 탭 밑줄 색 — 편집 모드면 파랑(ModeChip 과 통일), 보기 모드면 모노톤.
  const tabAccentColor =
    viewMode === "edit" ? "var(--accent-ink)" : "var(--ink)";

  // 활성 탭 글자수 — 에디터 하단 우측 sticky chip 으로 표시 (헤더 컨트롤 클러스터에서 분리).
  const activeCount =
    activeTab === "body"
      ? body.length
      : activeTab === "transcript"
        ? transcript.length
        : summary.length;

  // 빈 메모 CTA 클릭 — 편집 모드 전환 + 다음 frame 에 본문 textarea focus.
  // 본문 탭 active 일 때 transcript textarea 는 unmount → 활성 textarea 는 SourceBodyEditor 의 것 1개.
  function startEditing() {
    setViewMode("edit");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ta = scrollContainerRef.current?.querySelector("textarea");
        if (ta instanceof HTMLTextAreaElement) ta.focus();
      });
    });
  }

  return (
    <div className="relative min-h-svh lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {findOpen ? (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQueryAndReset}
          caseSensitive={findCase}
          onToggleCase={toggleFindCase}
          active={findActive < 0 ? 0 : Math.min(findActive, findMatches.length - 1) + 1}
          total={findMatches.length}
          onNext={findNext}
          onPrev={findPrev}
          onClose={closeFind}
          inputRef={findInputRef}
          expanded={replaceExpanded}
          onToggleExpanded={() => setReplaceExpanded((v) => !v)}
          replaceValue={replaceText}
          onReplaceChange={setReplaceText}
          onReplaceOne={replaceCurrent}
          onReplaceAll={replaceAll}
          canReplace={viewMode === "edit"}
        />
      ) : null}
      <PageHeaderBar
        sticky={false}
        left={
          <>
            <div
              className="inline-flex overflow-hidden rounded-md"
              style={{ border: "1px solid var(--line-2)" }}
            >
              <Button
                variant="ghost"
                onClick={() => {
                  const t = docHistory.undo();
                  if (t) routeToSource((t.from as DocSnapshot).__source);
                }}
                disabled={!docHistory.canUndo}
                title={`실행 취소 (${activeTab === "body" ? "메모" : activeTab === "transcript" ? "음성 기록" : "요약"})`}
                className="rounded-none px-1.5 py-1 disabled:opacity-20"
                style={{ color: "var(--sub)" }}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const t = docHistory.redo();
                  if (t) routeToSource((t.to as DocSnapshot).__source);
                }}
                disabled={!docHistory.canRedo}
                title={`다시 실행 (${activeTab === "body" ? "메모" : activeTab === "transcript" ? "음성 기록" : "요약"})`}
                className="rounded-none px-1.5 py-1 disabled:opacity-20"
                style={{ color: "var(--sub)", borderLeft: "1px solid var(--line-2)" }}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <SaveIndicator
              isPending={updateMutation.isPending || hasUnsavedChange}
              isError={updateMutation.isError}
              onRetry={retrySave}
            />
          </>
        }
        center={
          // typing 중엔 mutation X — onBlur / Enter 만 commit (매번 rename 회피).
          // field-sizing: input width 가 자동으로 content 길이 따라감.
          <input
            ref={titleInputRef}
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTitleDraft(initialTitle);
                skipNextTitleCommit.current = true;
                setActionError(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="untitled"
            autoFocus={!data.title}
            className="min-w-0 bg-transparent text-center text-base font-semibold outline-none"
            style={{
              color: "var(--ink)",
              fieldSizing: "content",
              maxWidth: "min(100%, 28rem)",
              textOverflow: "ellipsis",
              overflow: "hidden",
            } as React.CSSProperties}
          />
        }
        right={
          <MeetingActionMenu
            meeting={meetingForCopy}
            section={activeTab}
            pinned={data.pinned}
            onTogglePin={() =>
              togglePinMutation.mutate({ uid: data.uid, pinned: !data.pinned })
            }
            onMove={() => setMoveOpen(true)}
            onExport={() => setExportOpen(true)}
            onError={setActionError}
            onDelete={handleDelete}
            deleteDisabled={deleteMutation.isPending}
          />
        }
      />

      {/* Error toasts — fixed bottom-right, 본문 레이아웃에 영향 없음 */}
      {updateMutation.isError || actionError ? (
        <div
          className="fixed z-50 flex max-w-sm flex-col gap-2"
          style={{
            bottom: "calc(var(--safe-bottom) + 1rem)",
            right: "1rem",
          }}
        >
          {updateMutation.isError ? (
            <div
              className="animate-page-in flex flex-col gap-2 rounded-2xl p-3 text-sm backdrop-blur-xl backdrop-saturate-150"
              style={{
                backgroundColor: "var(--surface-frost)",
                border: "1px solid var(--surface-frost-border)",
                boxShadow: "var(--surface-frost-shadow)",
                color: "var(--ink)",
              }}
            >
              <div className="flex items-center gap-2">
                <Ban
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--down)" }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  자동 저장 실패
                </span>
                <Button
                  variant="icon"
                  onClick={() => updateMutation.reset()}
                  title="닫기"
                  aria-label="닫기"
                  className="shrink-0 p-0.5"
                  style={{ color: "var(--faint)" }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {updateMutation.error ? (
                <Text
                  variant="caption"
                  color="secondary"
                  as="div"
                  className="break-all wrap-anywhere"
                >
                  {formatError(updateMutation.error)}
                </Text>
              ) : null}
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  onClick={() =>
                    copyToastMessage(
                      updateMutation.error ? formatError(updateMutation.error) : "자동 저장 실패",
                      "update",
                    )
                  }
                  title="에러 메시지 복사"
                  aria-label="에러 메시지 복사"
                  className="p-1.5"
                  style={{ color: "var(--faint)" }}
                >
                  {copiedToast === "update" ? (
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--ok)" }} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={retrySave}
                  disabled={updateMutation.isPending}
                  className="disabled:opacity-40"
                >
                  {updateMutation.isPending ? "재시도 중..." : "재시도"}
                </Button>
              </div>
            </div>
          ) : null}
          {actionError ? (
            <div
              className="animate-page-in flex flex-col gap-2 rounded-2xl p-3 text-sm backdrop-blur-xl backdrop-saturate-150"
              style={{
                backgroundColor: "var(--surface-frost)",
                border: "1px solid var(--surface-frost-border)",
                boxShadow: "var(--surface-frost-shadow)",
                color: "var(--ink)",
              }}
            >
              <div className="flex items-center gap-2">
                <Ban
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--down)" }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  ERROR
                </span>
                <Button
                  variant="icon"
                  onClick={() => setActionError(null)}
                  title="닫기"
                  aria-label="닫기"
                  className="shrink-0 p-0.5"
                  style={{ color: "var(--faint)" }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Text
                variant="caption"
                color="secondary"
                as="div"
                className="break-all wrap-anywhere"
              >
                {actionError}
              </Text>
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  onClick={() => copyToastMessage(actionError, "action")}
                  title="에러 메시지 복사"
                  aria-label="에러 메시지 복사"
                  className="p-1.5"
                  style={{ color: "var(--faint)" }}
                >
                  {copiedToast === "action" ? (
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--ok)" }} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Tab nav — 헤더 바로 아래 고정 bar. scroll 컨테이너 *밖* 의 shrink-0 형제 —
          이전엔 scroll 안 sticky 였으나 스크롤바 트랙이 탭 row 까지 덮어 분리. 내부
          max-w-3xl 로 본문 탭 콘텐츠와 좌우 정렬 유지 (border/bg 도 column 폭). */}
      <div className="shrink-0">
        <div className="mx-auto w-full max-w-3xl px-6">
          <div
            className="flex items-center justify-between backdrop-blur"
            style={{
              borderBottom: "1px solid var(--line-2)",
              backgroundColor: "var(--bg-overlay)",
            }}
          >
            <Tabs
              items={[
                { key: "body", label: "메모" },
                { key: "transcript", label: "음성 기록" },
                { key: "summary", label: "요약" },
              ]}
              active={activeTab}
              onChange={(key) => setActiveTab(key as ActiveTab)}
              accentColor={tabAccentColor}
            />
            <div className="flex items-center gap-1.5 pb-1">
              {/* 탭별 액션 — 편집 토글 왼쪽. 음성 기록 업로드(편집 모드만) /
                  요약 자동요약·붙여넣기(항상). */}
              {showUploadAction ? (
                <TranscriptUploadButton
                  transcript={transcript}
                  onChange={(v) => {
                    const prevLines = doc.transcript.match(/\n/g)?.length ?? 0;
                    const newLines = v.match(/\n/g)?.length ?? 0;
                    if (newLines > prevLines) docHistory.flush();
                    setDoc("transcript", { ...doc, transcript: v });
                  }}
                  onError={setActionError}
                />
              ) : null}
              {showSummaryActions ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSummaryClick}
                  aria-disabled={summaryDisabled}
                  aria-label="요약하기"
                  title="요약하기 (자동 요약 / 직접 붙여넣기)"
                  leftIcon={<Sparkles className="h-4 w-4" />}
                  className={`px-2 py-1 ${summaryDisabled ? "opacity-40" : ""}`}
                />
              ) : null}
              {hasTabActions ? (
                <div
                  className="mx-0.5 h-4 w-px"
                  style={{ backgroundColor: "var(--line)" }}
                />
              ) : null}
              {/* 세 탭 모두 편집/보기 토글 (음성 기록 보기 = 읽기 전용 + 참석자 하이라이트). */}
              <ModeChip
                viewMode={viewMode}
                onToggle={() =>
                  setViewMode(viewMode === "edit" ? "view" : "edit")
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Full-page editor — desktop 에선 자체 scroll container (header 옆 scrollbar 회피).
          outer = full-width scroll, inner = max-w content.
          flex-col chain (scroll → content wrapper → tab content → mode div → editor) 으로
          빈 메모일 땐 editor 가 남은 높이 채움 + 스크롤 X, 내용 길어지면 자연 overflow.
          onScroll = 탭별 scroll 위치 매번 cache (탭/메모 전환 시 복원). */}
      <div
        ref={scrollContainerRef}
        className="lg:flex lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overscroll-none"
        onScroll={(e) => {
          SCROLL_CACHE.set(
            `${meetingId}:${activeTab}`,
            (e.currentTarget as HTMLDivElement).scrollTop,
          );
        }}
      >
        <div
          ref={contentWrapperRef}
          className="relative mx-auto w-full max-w-3xl px-6 pb-24 lg:flex lg:flex-1 lg:flex-col"
          onMouseDown={(e) => {
            // wrapper 의 padding 영역 (특히 pb-24 하단) 클릭 → 활성 textarea 끝으로 focus.
            // 좌우 px-6 (24px) 영역은 제외 — 사용자가 좌우 padding 은 클릭으로 잡지 말라고 했음.
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < 24 || x > rect.width - 24) return;
            const ta = e.currentTarget.querySelector("textarea");
            if (!(ta instanceof HTMLTextAreaElement)) return;
            e.preventDefault();
            ta.focus();
            const end = ta.value.length;
            ta.setSelectionRange(end, end);
          }}
        >
        {/* 보기 모드 찾기 현재 매치 하이라이트 — 줄당 박스 1개, 텍스트 위 반투명 오버레이. */}
        {findOpen && viewMode === "view"
          ? findHitRects.map((r, i) => (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none absolute rounded-[2px]"
                style={{
                  top: r.top,
                  left: r.left,
                  width: r.width,
                  height: r.height,
                  backgroundColor: "var(--find-highlight)",
                  zIndex: 5,
                }}
              />
            ))
          : null}
        {/* Tab content wrapper — 빈 메모일 땐 스크롤 없음, 내용 늘면 자연 scroll.
            lg:flex-1 chain 으로 자식 (editor) 가 남은 높이 채움. */}
        <div className="mt-4 lg:flex lg:flex-1 lg:flex-col">
        {activeTab === "body" ? (
          <div
            key={viewMode}
            className="lg:flex lg:flex-1 lg:flex-col"
            style={{ animation: "meetingViewFade 140ms ease" }}
          >
            {/* Metadata — 메모탭 안. 편집 모드 = MetaRow (icon + divider + input).
                보기 모드 = plain text (icon/divider 없음, 빈 field 안 보임). */}
            {viewMode === "edit" ? (
              <div className="mb-4">
                <MetaRow
                  icon={<CalendarIcon className="h-3.5 w-3.5" />}
                  label="날짜"
                >
                  <LooseDateInput
                    value={meta.date}
                    onCommit={commitDate}
                  />
                </MetaRow>
                <MetaRow
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="시간"
                >
                  <LooseTimeInput
                    value={meta.time}
                    onCommit={commitTime}
                  />
                </MetaRow>
                <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="참석자">
                  <div className="flex-1">
                    <AttendeeTagInput
                      value={attendeesDraft}
                      onChange={commitAttendees}
                      suggestions={attendeeSuggestions}
                      placeholder="이름 입력 후 Enter"
                    />
                  </div>
                </MetaRow>
              </div>
            ) : (
              <MetaReadOnly meta={meta} />
            )}
            {viewMode === "edit" ? (
              <SourceBodyEditor
                key={`${meetingId}:body`}
                content={body}
                onChange={(v) => {
                  // 줄이 늘었으면 직전 줄까지 별도 entry.
                  const prevLines = (doc.body.match(/\n/g)?.length ?? 0);
                  const newLines = (v.match(/\n/g)?.length ?? 0);
                  if (newLines > prevLines) docHistory.flush();
                  setDoc("body", { ...doc, body: v });
                }}
                onSendLineToInbox={(lineText) => {
                  setTaskModalPrefill(lineToTaskPrefill(lineText, meetingId));
                  setTaskModalOpen(true);
                }}
                onImageAttach={onImageAttach}
              />
            ) : body.trim() === "" ? (
              <EmptyBodyCTA onStartEdit={startEditing} />
            ) : (
              <div data-find-content>
                <MarkdownView
                  content={body}
                  onChange={(v) => {
                    // 체크박스 토글은 단일 캐릭터 변경 — 별 history entry 로 두는 게
                    // 옵시디안 동작에 맞음 (입력처럼 coalesce 하면 직전 textarea 변경에
                    // 합쳐져 undo 가 어색해짐).
                    setDoc("body", { ...doc, body: v }, true);
                  }}
                  onAddTaskFromLine={(lineText) => {
                    setTaskModalPrefill(lineToTaskPrefill(lineText, meetingId));
                    setTaskModalOpen(true);
                  }}
                />
              </div>
            )}
          </div>
        ) : null}

        {/* Transcript tab — 메타는 본문 탭에서만 편집 가능. 여기선 readOnly 만.
            파일 업로드는 메타 칩 trailing 으로 (요약 탭 아이콘 버튼 패턴과 통일). */}
        {activeTab === "transcript" ? (
          <div>
            {viewMode === "edit" ? (
              <MetaReadOnly meta={meta} boxed />
            ) : (
              <MetaReadOnly meta={meta} />
            )}
            <div
              key={`transcript:${viewMode}`}
              style={{ animation: "meetingViewFade 140ms ease" }}
            >
              {viewMode === "edit" ? (
                <TranscriptArea
                  key={`${meetingId}:transcript`}
                  transcript={transcript}
                  onChange={(v) => {
                    const prevLines = (doc.transcript.match(/\n/g)?.length ?? 0);
                    const newLines = (v.match(/\n/g)?.length ?? 0);
                    if (newLines > prevLines) docHistory.flush();
                    setDoc("transcript", { ...doc, transcript: v });
                  }}
                />
              ) : (
                <div data-find-content>
                  <TranscriptView
                    transcript={transcript}
                    attendees={meta.attendees}
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Summary tab — 메타는 본문 탭에서만 편집 가능. 여기선 readOnly 만.
            액션(자동요약·붙여넣기)은 헤더 우측 아이콘으로 이동. 요약 없을 땐
            본문 중앙 EmptyState 로 두 CTA 유도 (헤더 아이콘과 별개, 첫 진입 안내). */}
        {activeTab === "summary" ? (
          <div className="space-y-4">
            {viewMode === "edit" ? (
              <MetaReadOnly meta={meta} boxed />
            ) : (
              <MetaReadOnly meta={meta} />
            )}
            {hasAnySummary ? (
              <div
                key={`summary:${viewMode}`}
                className="lg:flex lg:flex-1 lg:flex-col"
                style={{ animation: "meetingViewFade 140ms ease" }}
              >
                {viewMode === "edit" ? (
                  <SourceBodyEditor
                    key={`${meetingId}:summary`}
                    content={summary}
                    onChange={(v) => {
                      const prevLines = (doc.summary.match(/\n/g)?.length ?? 0);
                      const newLines = (v.match(/\n/g)?.length ?? 0);
                      if (newLines > prevLines) docHistory.flush();
                      setDoc("summary", { ...doc, summary: v });
                    }}
                    onSendLineToInbox={(lineText) => {
                      setTaskModalPrefill(lineToTaskPrefill(lineText, meetingId));
                      setTaskModalOpen(true);
                    }}
                    onImageAttach={onImageAttach}
                  />
                ) : (
                  <div data-find-content>
                    <MarkdownView
                      content={summary}
                      onChange={(v) => {
                        setDoc("summary", { ...doc, summary: v }, true);
                      }}
                      onAddTaskFromLine={(lineText: string) => {
                        setTaskModalPrefill(lineToTaskPrefill(lineText, meetingId));
                        setTaskModalOpen(true);
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={
                  <Sparkles
                    className="h-12 w-12"
                    style={{ color: "var(--faint)" }}
                    strokeWidth={1.25}
                  />
                }
                title="요약이 아직 없습니다"
                description={
                  summaryDisabled
                    ? "메모나 음성 기록을 먼저 작성하면 요약할 수 있습니다."
                    : "Claude 로 자동 요약하거나 직접 붙여넣어 시작하세요."
                }
                action={
                  <Button
                    variant="primary"
                    onClick={handleSummaryClick}
                    aria-disabled={summaryDisabled}
                    leftIcon={<Sparkles className="h-4 w-4" />}
                    className={`px-3 py-2 ${summaryDisabled ? "opacity-60" : ""}`}
                  >
                    요약하기
                  </Button>
                }
              />
            )}
          </div>
        ) : null}
        </div>

        {/* 글자수 — 뷰포트 우측하단 고정 (fixed). 스크롤·드래그 선택과 무관하게 위치
            불변. 흐린 frost chip. 에러 토스트(z-50)보다 아래(z-40) 라 겹치면 토스트 우선.
            count 0 이면 숨김. */}
        {activeCount > 0 ? (
          <div
            className="pointer-events-none fixed z-40"
            style={{ bottom: "calc(var(--safe-bottom) + 0.75rem)", right: "1rem" }}
          >
            <span
              className="rounded-md px-2 py-0.5 text-xs backdrop-blur"
              style={{
                backgroundColor: "var(--bg-overlay)",
                color: "var(--faint)",
              }}
            >
              {activeCount.toLocaleString("ko-KR")}자
            </span>
          </div>
        ) : null}
        </div>
      </div>
      <TaskAddModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        prefill={taskModalPrefill}
      />
      <SummaryModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        promptInput={summaryPromptInput}
        onApply={applySummaryFromModal}
      />
      <MoveFolderModal
        open={moveOpen}
        meetingId={data.id}
        meetingTitle={data.title ?? ""}
        onClose={() => setMoveOpen(false)}
        onMove={async (folder) => {
          await moveMutation.mutateAsync({ uid: data.uid, folder });
        }}
      />
      <MeetingExportModal
        meeting={exportOpen ? meetingForCopy : null}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}

// 메모 안 한 줄 → TaskAddModal prefill. extractTasks parser 가 자연어까지 처리
// (오늘, 내일, 월/화/일요일, 한글/압축 날짜, "오후 2시" 등).
// 문법: `- [x] 본문 --- (날짜) (시간) #category #priority`
//   - [x] / [ ]    = done
//   --- 또는 —     = date/time split (앞 본문, 뒤 매칭 토큰들)
//   #work / #meeting       = category
//   #high / #medium / #low = priority
// 매칭 안 되는 토큰은 모두 본문으로 (예 `[안건 1]` 같은 bracket).
function lineToTaskPrefill(
  lineText: string,
  meetingUid: string,
): Partial<TaskInsert> {
  const items = extractTasks("inbox.md", `${lineText}\n`);
  const item = items[0];
  if (!item) return { source_meeting_uid: meetingUid };
  const prefill: Partial<TaskInsert> = {
    title: item.text,
    done: item.done,
    source_meeting_uid: meetingUid,
  };
  if (item.due) prefill.due_date = item.due;
  if (item.time) prefill.due_time = item.time;
  const pri = item.tags.find((t): t is TaskPriority =>
    t === "high" || t === "medium" || t === "low",
  );
  if (pri) prefill.priority = pri;
  return prefill;
}

// 본문 탭 활성 시 글자수 옆 chip — 현재 viewMode 표시 + 클릭 토글.
// 본문 textarea 의 line gutter 패턴과 동일: icon col (1.75rem) + 우측 divider + 라벨 + 값.
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="meta-row flex" style={{ minHeight: "1.625rem" }}>
      <div
        className="flex shrink-0 items-center justify-center"
        style={{
          width: "1.75rem",
          color: "var(--faint)",
          borderRight: "1px solid var(--line-2)",
        }}
      >
        {icon}
      </div>
      <div
        className="flex flex-1 items-center gap-3 text-sm"
        style={{ paddingLeft: "0.5rem", color: "var(--ink)" }}
      >
        <span
          className="shrink-0"
          style={{ color: "var(--faint)", width: "3.5rem" }}
        >
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}

// 읽기 전용 meta — icon/divider 없는 plain text. 빈 field 안 보임.
// 편집 모드 MetaRow 와 같은 line height (1.625rem) + 라벨 위치.
//  - 기본 (보기 모드, 메모·음성기록·요약 공통): 박스 없는 평문.
//  - boxed (음성기록·요약 편집 모드): 회색 박스 + 전체 muted — 메타 편집은 메모 탭에서만
//    가능함을 시각적으로 명확히 (입력칸 MetaRow 와 구분).
function MetaReadOnly({ meta, boxed }: { meta: MetaDoc; boxed?: boolean }) {
  const rows: { label: string; value: string }[] = [];
  if (meta.date) rows.push({ label: "날짜", value: formatDisplayDate(meta.date) });
  if (meta.time) rows.push({ label: "시간", value: meta.time });
  if (meta.attendees) rows.push({ label: "참석자", value: meta.attendees });
  if (rows.length === 0) return null;
  const inner = rows.map((r) => (
    <div
      key={r.label}
      className="flex items-center gap-3"
      style={{ minHeight: "1.625rem" }}
    >
      <Text
        variant="body"
        color="muted"
        as="span"
        className="shrink-0"
        style={{ width: "3.5rem" }}
      >
        {r.label}
      </Text>
      <Text variant="body" color={boxed ? "muted" : undefined} as="span">
        {r.value}
      </Text>
    </div>
  ));
  if (boxed) {
    // 박스의 padding·border 를 동일 크기의 negative margin 으로 상쇄 → 박스는 바깥으로
    // bleed 하되 안쪽 텍스트는 보기 모드(박스 없음)와 정확히 같은 위치. 모드 토글 시 점프 X.
    return (
      <div
        className="rounded-lg"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line-2)",
          padding: "0.5rem 0.75rem",
          marginTop: "calc(-0.5rem - 1px)",
          marginLeft: "calc(-0.75rem - 1px)",
          marginRight: "calc(-0.75rem - 1px)",
          // 보기 모드의 mb-4(1rem) 와 같은 하단 간격 유지 (padding 0.5rem + border 1px 보정).
          marginBottom: "calc(0.5rem - 1px)",
        }}
      >
        {inner}
      </div>
    );
  }
  return (
    <Text variant="body" as="div" className="mb-4">
      {inner}
    </Text>
  );
}

function EmptyBodyCTA({ onStartEdit }: { onStartEdit: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onStartEdit}
      className="group flex-col w-full justify-center gap-3 rounded-lg text-center"
      style={{
        minHeight: "60vh",
        border: "1px dashed var(--line-2)",
        color: "var(--faint)",
        backgroundColor: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface)";
        e.currentTarget.style.color = "var(--sub)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--faint)";
      }}
    >
      <Pencil className="h-6 w-6" />
      <Text variant="body" as="div">
        편집을 시작하려면 클릭하세요
      </Text>
      {isTauri ? (
        <Text variant="caption" as="div" className="flex items-center gap-1.5">
          <span>또는</span>
          <Kbd
            style={{
              borderColor: "var(--line-2)",
              color: "var(--faint)",
              backgroundColor: "var(--surface)",
            }}
          >
            ⌘⇧E
          </Kbd>
        </Text>
      ) : null}
    </Button>
  );
}

// 음성 기록 파일 업로드 — 메타 칩 trailing 자리에 들어가는 컴팩트 아이콘 버튼.
// 요약 탭의 자동/직접 아이콘 버튼과 같은 visual 어휘 (secondary-sm + 툴팁).
function TranscriptUploadButton({
  transcript,
  onChange,
  onError,
}: {
  transcript: string;
  onChange: (v: string) => void;
  onError: (msg: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") {
        onError("파일을 텍스트로 읽지 못했어요");
        return;
      }
      onChange(transcript ? `${transcript}\n\n${text}` : text);
    };
    reader.onerror = () => onError("파일 읽기 실패");
    reader.readAsText(file);
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        title="파일 업로드 (txt / md / vtt / srt)"
        leftIcon={<Upload className="h-4 w-4" />}
        className="px-2 py-1"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.vtt,.srt,text/*"
        onChange={handleFile}
        className="hidden"
      />
    </>
  );
}

function TranscriptArea({
  transcript,
  onChange,
}: {
  transcript: string;
  onChange: (v: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 메모탭 SourceBodyEditor 와 같은 auto-resize 패턴 — 자체 scroll X, outer scroll
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [transcript]);

  // macOS smart substitution fallback (autoCorrect="off" 안 막힐 때)
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

  function onContainerMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      const el = textareaRef.current;
      if (!el) return;
      e.preventDefault();
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }

  return (
    <div>
      <div onMouseDown={onContainerMouseDown} style={{ minHeight: "60vh" }}>
        <textarea
          ref={textareaRef}
          value={transcript}
          onChange={(e) => onChange(e.target.value)}
          placeholder="회의 또는 관련 대화 내용을 파일로 업로드하거나 직접 적어주세요..."
          className="w-full resize-none bg-transparent text-base leading-relaxed outline-none"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            color: "var(--ink)",
            overflowY: "hidden",
          }}
        />
      </div>
    </div>
  );
}

// 음성 기록 보기 모드 — 읽기 전용 평문(pre-wrap, 마크다운 렌더 X) + 참석자별 색상 칩
// + mm:ss 타임스탬프(회색 박스) 하이라이트. textarea 안에선 inline 색을 못 넣어 div 로
// 렌더 → 자연히 편집 불가. STT 줄바꿈/들여쓰기 보존.
const SPEAKER_COLOR_COUNT = 10; // index.css 의 --speaker-0..9 와 일치.

function TranscriptView({
  transcript,
  attendees,
}: {
  transcript: string;
  attendees: string;
}) {
  // 참석자 문자열(", " join) → 적힌 순서 유지 unique 이름 배열. 1글자 이름은 오버매치
  // (전부 하이라이트) 회피로 제외. 색은 이 순서대로 i%N 배정 → 한 회의 안 색 안 겹침.
  const orderedNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of attendees.split(",")) {
      const n = raw.trim();
      if (n.length >= 2 && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [attendees]);

  // 이름 → speaker 색 인덱스 (적힌 순서 기준, 매칭 정렬과 무관).
  const colorOf = useMemo(() => {
    const m = new Map<string, number>();
    orderedNames.forEach((n, i) => m.set(n, i % SPEAKER_COLOR_COUNT));
    return m;
  }, [orderedNames]);

  // 참석자 이름 + mm:ss / h:mm:ss 타임스탬프를 한 토크나이저로 분리. named group 으로
  // 어느 종류가 매칭됐는지 판별. 둘 다 없으면 통짜 plain.
  const segments = useMemo<
    { text: string; kind: "plain" | "name" | "time" }[]
  >(() => {
    if (transcript.length === 0) return [];
    const patterns: string[] = [];
    if (orderedNames.length > 0) {
      // 매칭은 긴 이름 우선(부분 매칭 방지) — 색 배정 순서와 무관하므로 정렬 복사본.
      const escaped = [...orderedNames]
        .sort((a, b) => b.length - a.length)
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      patterns.push(`(?<name>${escaped.join("|")})`);
    }
    // STT 시간 마커 — 1:23 / 01:23 / 1:23:45. 단어 경계로 12.3 같은 숫자 오매칭 회피.
    patterns.push(`(?<time>\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b)`);
    const re = new RegExp(patterns.join("|"), "g");
    const out: { text: string; kind: "plain" | "name" | "time" }[] = [];
    let last = 0;
    for (const m of transcript.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ text: transcript.slice(last, idx), kind: "plain" });
      out.push({ text: m[0], kind: m.groups?.name ? "name" : "time" });
      last = idx + m[0].length;
    }
    if (last < transcript.length) {
      out.push({ text: transcript.slice(last), kind: "plain" });
    }
    return out;
  }, [transcript, orderedNames]);

  if (transcript.trim() === "") {
    return (
      <div style={{ minHeight: "60vh" }}>
        <Text variant="body" color="muted" as="p">
          음성 기록이 없습니다. 편집 모드에서 입력하거나 파일을 업로드하세요.
        </Text>
      </div>
    );
  }

  return (
    <div
      className="text-base leading-relaxed"
      style={{
        minHeight: "60vh",
        color: "var(--ink)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        // 보기 모드 음성 기록도 외부 복사 주 경로 — body { user-select: none } 를
        // override 해 드래그 선택 허용 (.markdown-view 와 동일 정책).
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {segments.map((seg, i) => {
        if (seg.kind === "name") {
          const ci = colorOf.get(seg.text) ?? 0;
          return (
            <span
              key={i}
              className="rounded px-1"
              style={{
                backgroundColor: `var(--speaker-${ci}-bg)`,
                color: `var(--speaker-${ci}-text)`,
              }}
            >
              {seg.text}
            </span>
          );
        }
        if (seg.kind === "time") {
          // 인라인 코드 칩과 동일 레시피 (MarkdownView) — surface-hover + primary.
          // surface-active 는 한 단계 진한 active/선택 상태색이라 정적 칩엔 무거움.
          return (
            <span
              key={i}
              className="rounded px-1 py-0.5 font-mono"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--ink)",
              }}
            >
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </div>
  );
}
