import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VaultGate } from "./components/vault/VaultGate";
import { VaultImageIndexProvider } from "./lib/markdown/VaultImageIndexProvider";
import { AppShell } from "./components/nav/AppShell";
import { GlobalTooltip } from "./components/Tooltip";
import { ToastProvider, useToast } from "./components/Toast";
import { TABS, type Tab } from "./components/nav/BottomTabs";
import { MeetingForm } from "./components/meetings/MeetingForm";
import { QuickSwitcher } from "./components/meetings/QuickSwitcher";
import { TaskAddModal } from "./components/tasks/TaskAddModal";
import { TrashModal } from "./components/meetings/TrashModal";
import { PortfolioTrashModal } from "./components/portfolio/PortfolioTrashModal";
import { PortfolioGuideModal } from "./components/portfolio/PortfolioGuideModal";
import {
  MeetingsSidePanel,
  MeetingsSidePanelFooter,
  PortfolioSidePanelFooter,
  TodosSidePanel,
  TodosSidePanelFooter,
  RoutinesSidePanel,
  RoutinesSidePanelFooter,
  type TaskStatusFilter,
} from "./components/nav/SidePanel";
import { useTaskSort } from "./hooks/useTaskSort";
import { usePortfolioSort } from "./hooks/usePortfolioSort";
import { usePortfolioCategoryFilter } from "./hooks/usePortfolioCategoryFilter";
import type { TaskInsert } from "./api/tasks";
import { TodosTrashModal } from "./components/tasks/TodosTrashModal";
import { Text } from "./components/common/Text";
import { EmptyState } from "./components/common/EmptyState";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { PageHeaderBar } from "./components/common/PageHeaderBar";
import { TodayPage } from "./pages/TodayPage";
import { TodayAgendaPanel } from "./components/today/TodayAgendaPanel";
import { JournalOverlay } from "./components/calendar/JournalOverlay";
import { TasksPage } from "./pages/TasksPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { StyleguidePage } from "./pages/StyleguidePage";
import { PortfolioSidePanel } from "./components/portfolio/PortfolioSidePanel";
import { InstallGuideModal } from "./components/portfolio/InstallGuideModal";
import { AuthGuideModal } from "./components/portfolio/AuthGuideModal";
import { RoutineDetail } from "./components/routines/RoutineDetail";
import type { SourceFilter } from "./components/portfolio/PortfolioSourceTree";
import {
  useGhSync,
  useManualFolders,
  usePortfolioWorks,
} from "./hooks/usePortfolio";
import { GhAuthError, GhNotInstalledError } from "./lib/portfolio/gh";
import { useMeetings, useCreateMeeting, useDeleteMeeting } from "./hooks/useMeetings";
import { useMeetingSort } from "./hooks/useMeetingSort";
import { buildMeetingSortComparator } from "./lib/meetingSort";
import { meetingFolder } from "./api/meetings";
import { useJournals } from "./hooks/useJournals";
import { useTasks } from "./hooks/useTasks";
import { useVault } from "./lib/vault/useVault";
import { maybeAutoBackup } from "./lib/backup";
import { DrawerProvider, useDrawer } from "./hooks/useDrawer";
import { useSidebarCollapsed } from "./hooks/useSidebarCollapsed";
import { todayIso } from "./lib/dates";

function readTabFromHash(): Tab {
  const h = window.location.hash;
  if (h.startsWith("#meeting-")) return "meetings";
  if (h === "#today") return "today";
  if (h === "#meetings") return "meetings";
  if (h === "#todos") return "todos";
  if (h === "#routines") return "routines";
  if (h === "#portfolio") return "portfolio";
  // 빈 hash = 첫 탭 ("오늘"). SIMPLIFY: "오늘" 대시보드가 default landing.
  return TABS[0].id;
}

function readMeetingFromHash(): string | null {
  const h = window.location.hash;
  if (h.startsWith("#meeting-")) return h.slice("#meeting-".length) || null;
  return null;
}

// 세션 단위 한 번만 자동 선택. 사용자가 명시적으로 onBack/닫기 한 뒤 페이지
// 전환했다가 돌아와도 다시 자동 선택되지 않도록 모듈 변수로 보관. 새로고침하면
// 모듈이 다시 import 되며 false.
let didAutoSelectThisSession = false;

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // 브라우저 default drop = 떨어진 이미지 파일을 새 page 로 열어버림 — 뒤로가기도
  // 못 함 (history 0). textarea 밖에 잘못 drop 한 사용자가 앱을 닫을 수밖에 없는 함정.
  // window 레벨에서 dragover/drop default 항상 차단 — textarea 의 onDrop 은 핸들러
  // 단계에서 e.preventDefault 한 뒤 stopPropagation 없이 그대로 bubble (이중 차단).
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  if (hash === "#styleguide") return <StyleguidePage />;

  return (
    <ErrorBoundary>
      <VaultGate>
        <VaultImageIndexProvider>
          <GlobalTooltip />
          <ToastProvider>
            <DrawerProvider>
              <AppContent />
            </DrawerProvider>
          </ToastProvider>
        </VaultImageIndexProvider>
      </VaultGate>
    </ErrorBoundary>
  );
}

function AppContent() {
  const drawer = useDrawer();
  const [tab, setTab] = useState<Tab>(() => readTabFromHash());
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(() =>
    readMeetingFromHash(),
  );
  // 일기 오버레이 — null = 닫힘. 메인 "오늘 일기" 블록 + 사이드바 날짜 헤더 클릭이
  // 모두 이 한 오버레이를 연다 (캘린더 탭 폐기 후 유일한 일기 진입점).
  const [journalDate, setJournalDate] = useState<string | null>(null);
  // 날짜 상세 모달 — null = 닫힘. "오늘" 사이드바 날짜·일정 클릭이 연다.
  // "오늘" 탭 메인창이 보여줄 날짜. 기본=오늘, 사이드바 날짜 선택 시 갱신.
  // 탭을 떠났다 돌아오면 오늘로 리셋(탭 정체성 유지) — 아래 effect.
  const [selectedDay, setSelectedDay] = useState<string>(() => todayIso());
  const [taskStatus, setTaskStatus] = useState<TaskStatusFilter>("all");
  // 선택된 할 일 프로젝트 파일(`tasks/{이름}.md`). null = 전체.
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [taskSortKey, setTaskSortKey] = useTaskSort();
  const [portfolioFilter, setPortfolioFilter] = useState<SourceFilter>({
    kind: "all",
  });
  // 할 일 탭 안 routine 선택 — null = 태스크 필터 모드 (기존 TasksPage).
  const [selectedRoutineName, setSelectedRoutineName] = useState<string | null>(null);
  // task/routine 추가 모달 — App.tsx 가 owner. RoutineDetail / TasksPage 어느 쪽이
  // 마운트되어도 사이드바 + 가 trigger 하면 보임. event detail 로 type/prefill 받음.
  const [taskAddOpen, setTaskAddOpen] = useState(false);
  const [taskAddPrefill, setTaskAddPrefill] = useState<Partial<TaskInsert> | undefined>(undefined);
  const [taskAddType, setTaskAddType] = useState<"task" | "routine">("task");

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { type?: "task" | "routine"; prefill?: Partial<TaskInsert> }
        | undefined;
      setTaskAddType(detail?.type ?? "task");
      setTaskAddPrefill(detail?.prefill ?? {});
      setTaskAddOpen(true);
    }
    window.addEventListener("todos:add-request", handler);
    return () => window.removeEventListener("todos:add-request", handler);
  }, []);
  // 오늘 대시보드/사이드바의 task 클릭으로 진입 시 TasksPage 가 한 번 scroll 후 clear.
  const [scrollToTaskId, setScrollToTaskId] = useState<string | null>(null);
  const [portfolioSortKey, setPortfolioSortKey] = usePortfolioSort();
  const portfolioCategoryFilter = usePortfolioCategoryFilter();
  // 휴지통은 overlay — utility 액션이라 SettingsModal 과 같은 패턴.
  // 탭별 1 trash — 할 일 탭은 태스크/루틴 둘 다 chip 으로 구분한 단일 flat 리스트.
  const [trashOpen, setTrashOpen] = useState(false);
  const [todosTrashOpen, setTodosTrashOpen] = useState(false);
  const [portfolioTrashOpen, setPortfolioTrashOpen] = useState(false);
  const [portfolioGuideOpen, setPortfolioGuideOpen] = useState(false);
  // 옵시디안 quick switcher (Cmd+P). 메모장 탭에 한정하지 않고 어디서든 발사 가능 —
  // 선택 시 메모장 탭으로 자동 이동. 검색 인덱스 build 는 모달 open 시점에 lazy.
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const portfolioSync = useGhSync();
  const toast = useToast();
  // gh 연결 가이드 모달 — 사용자 명시 동기화 클릭 시 에러 종류 보고 자동 open.
  // background auto-sync 는 silent 유지 (5초마다 모달 뜨면 noise).
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [authGuideOpen, setAuthGuideOpen] = useState(false);

  // 에러 종류 보고 적절 모달 trigger. toast 는 일반 에러 (네트워크 등) 만.
  const handleSyncError = (err: unknown, label: string) => {
    console.error(`[portfolio] ${label} failed:`, err);
    if (err instanceof GhNotInstalledError) {
      setInstallGuideOpen(true);
      return;
    }
    if (err instanceof GhAuthError) {
      setAuthGuideOpen(true);
      return;
    }
    toast.show("동기화에 실패했습니다. 네트워크 연결을 확인하세요.");
  };

  // last_sync - 1일 buffer 의 YYYY-MM-DD. 첫 sync (last_sync 없음) 면 undefined → 전체.
  // gh search 의 `merged:>=YYYY-MM-DD` 가 날짜 단위라 1일 buffer 충분.
  const portfolioRunIncrementalSync = async () => {
    try {
      await portfolioSync.run({ incremental: true });
    } catch (err) {
      handleSyncError(err, "incremental sync");
    }
  };
  const portfolioRunFullSync = async () => {
    try {
      await portfolioSync.run({});
    } catch (err) {
      handleSyncError(err, "full sync");
    }
  };
  const { adapter, isReady } = useVault();
  const meetings = useMeetings();
  // 사이드바와 같은 sortKey 공유 — 메모 삭제 후 자동 선택 / Cmd+↑/↓ 이동이
  // 사이드바 시각 순서와 일치해야 직관 맞음. localStorage 통해 동기화.
  const [meetingSortKey] = useMeetingSort();
  const meetingSortComparator = useMemo(
    () => buildMeetingSortComparator(meetingSortKey),
    [meetingSortKey],
  );
  const sidebar = useSidebarCollapsed();
  const createMeetingMutation = useCreateMeeting();
  const deleteMeetingMutation = useDeleteMeeting();
  // 폴더 자동 펼침 신호 — App 이 단일 소유. nonce 증가 → MeetingsSidePanel →
  // MeetingsTreeView 가 그 폴더(+조상)를 collapsed 에서 제거. Cmd+N(아래)·사이드바
  // "+"·폴더 생성 모두 requestMeetingReveal 로 모여 트리거.
  const [meetingReveal, setMeetingReveal] = useState<{
    path: string;
    nonce: number;
  }>({ path: "", nonce: 0 });
  const requestMeetingReveal = useCallback((path: string) => {
    if (!path) return; // root 는 항상 보여 펼칠 게 없음
    setMeetingReveal((r) => ({ path, nonce: r.nonce + 1 }));
  }, []);
  // 마크다운 도움말 패널 open — footer 버튼(좌측하단)이 토글, 패널은 콘텐츠 영역만
  // 덮어 하단바 유지. 상태를 App 이 소유해 footer 슬롯·sidePanel 슬롯이 공유.
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false);
  const autoSyncDone = useRef(false);
  const autoBackupDone = useRef(false);
  const autoSelectedRef = useRef(didAutoSelectThisSession);

  // V0.7 design step 3 (1B): vault ready 후 5초 background sync 1회 (since=last_sync).
  // 본인 매일 앱 켜면 silent fetch — 의식 0 으로 카드 누적. 서버의 gh 위임으로 호출.
  // useGhSync 의 callId 가드 + cancel 강제 리셋 덕분에 stuck 회복 가능 (V0.7.x).
  useEffect(() => {
    if (!isReady || autoSyncDone.current) return;
    autoSyncDone.current = true;
    const t = setTimeout(() => {
      portfolioSync.run({ incremental: true }).catch((err) => {
        // background — silent. 5초마다 toast 뜨면 noise. 사용자 트리거 sync 만 toast.
        console.error("[portfolio] background sync failed:", err);
      });
    }, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // 자동 백업 — vault ready 후 10초 뒤 1회. interval/keepCount 설정에 따라 실행.
  // 1초+ 걸리면 progress toast 로 freeze 같은 체감 차단.
  useEffect(() => {
    if (!isReady || autoBackupDone.current) return;
    autoBackupDone.current = true;
    const t = setTimeout(async () => {
      let progressId: number | null = null;
      const progressTimer = setTimeout(() => {
        progressId = toast.show("vault 자동 백업 중… (크기에 따라 1-10초)", {
          kind: "progress",
        });
      }, 1000);
      try {
        await maybeAutoBackup(adapter);
      } catch (err) {
        console.error("auto backup failed", err);
      } finally {
        clearTimeout(progressTimer);
        if (progressId !== null) toast.dismiss(progressId);
      }
    }, 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // 메모장 진입 시 세션당 한 번 자동 선택 (V0.5.3). 모듈 flag 로 페이지 갔다와도
  // 다시 발동 안 함. 메모 0개면 skip.
  useEffect(() => {
    if (tab !== "meetings") return;
    if (autoSelectedRef.current) return;
    if (selectedMeetingId) {
      autoSelectedRef.current = true;
      didAutoSelectThisSession = true;
      return;
    }
    const list = meetings.data;
    if (!list || list.length === 0) return;
    autoSelectedRef.current = true;
    didAutoSelectThisSession = true;
    openMeeting(list[0].uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedMeetingId, meetings.data]);

  // list 로드 후 selectedMeetingId 가 이미 사라진 uid 면 정리. 케이스:
  //   1. 노트 삭제 직후 closeMeeting→history.back 이 stale entry (그 사이 purge 된 메모) 의
  //      uid 로 popstate 를 발사 → setSelectedMeetingId 가 dead uid 로 set
  //   2. 초기 진입 시 URL hash 가 다른 세션에서 삭제된 메모 uid (옵시디안 모바일 sync 등)
  // 어느 쪽이든 selectedMeetingId 를 그대로 두면 useMeeting 이 throw → React Query retry 3회 →
  // 영구 error UI. list cache 에 없으면 null 로 fallback + hash 정리 (다음 back 이 재발 X).
  useEffect(() => {
    if (!meetings.isSuccess) return;
    if (!selectedMeetingId) return;
    const exists = meetings.data?.some((m) => m.uid === selectedMeetingId);
    if (exists) return;
    // 의도: list cache 가 도착했는데 hash 의 uid 가 사라진 케이스 — 즉시 정리.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedMeetingId(null);
    if (window.location.hash.startsWith("#meeting-")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [meetings.isSuccess, meetings.data, selectedMeetingId]);

  useEffect(() => {
    function syncFromHash() {
      setTab(readTabFromHash());
      // hash 에 meeting id 가 있을 때만 set. 다른 탭으로 갔을 땐 selectedMeetingId
      // 를 보존 — 메모장 돌아오면 그 메모가 다시 열림.
      const idFromHash = readMeetingFromHash();
      if (idFromHash !== null) {
        setSelectedMeetingId(idFromHash);
      }
    }
    window.addEventListener("popstate", syncFromHash);
    window.addEventListener("hashchange", syncFromHash);
    return () => {
      window.removeEventListener("popstate", syncFromHash);
      window.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  // macOS WKWebView 가 Backspace/Delete 를 history.back() 으로 처리 — SPA state 망가짐.
  // 텍스트 입력 컨텍스트가 아니면 막음.
  useEffect(() => {
    function blockNavKeys(e: KeyboardEvent) {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", blockNavKeys);
    return () => window.removeEventListener("keydown", blockNavKeys);
  }, []);

  // 페이지 단축키 (web·PWA 공통): Cmd+1/2/3/4 (TABS index), Cmd+\ (사이드바 토글),
  // Cmd+P (퀵스위처). 탭 순서 바뀌면 단축키 의미도 자동 swap (오늘 첫번째 → Cmd+1=오늘).
  // ⚠️ 일반 브라우저 탭은 Cmd+숫자·Cmd+P 를 브라우저가 먼저 가로챌 수 있음 —
  //    standalone PWA(홈 화면 설치)에선 앱이 받는다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      // Cmd+\ — 사이드바 collapse 토글 (input/textarea 안에서도 동작)
      if (e.key === "\\") {
        e.preventDefault();
        sidebar.toggle();
        return;
      }
      // Cmd+P — quick switcher 모달 토글 (input/textarea 안에서도 동작).
      // Cmd+P 를 퀵스위처로 override — standalone PWA 에선 인쇄보다 이게 유용.
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setQuickSwitcherOpen((v) => !v);
        return;
      }
      const idx = "123456789".indexOf(e.key);
      if (idx === -1) return;
      const target = TABS[idx];
      if (!target) return;
      e.preventDefault();
      switchTab(target.id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // switchTab 은 의도적으로 dep 제외 — 매 렌더 새 ref 라 listener re-register 폭주 회피.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeetingId, sidebar.toggle]);


  // 메모장 단축키 (web·PWA 공통):
  // - Cmd+N: 새 메모 생성 + 자동 선택 (textarea 안에서도 동작)
  // - Cmd+Backspace/Delete: 현재 메모 삭제 (input/textarea 밖에서만)
  // - Cmd+↑/↓: 이전/다음 메모 (input/textarea 밖에서만)
  useEffect(() => {
    if (tab !== "meetings") return;

    function isInTextInput(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return t.isContentEditable;
    }

    async function handleCreate() {
      if (createMeetingMutation.isPending) return;
      // 현재 선택된 메모가 있으면 그 메모의 폴더에 생성 (없으면 root).
      const current = (meetings.data ?? []).find(
        (m) => m.uid === selectedMeetingId,
      );
      const folder = current ? meetingFolder(current.id) : "";
      try {
        const created = await createMeetingMutation.mutateAsync({
          title: null,
          date: todayIso(),
          time: null,
          attendees: null,
          content: "",
          summary: null,
          folder,
        });
        requestMeetingReveal(folder);
        openMeeting(created.uid);
      } catch {
        // 사이드 패널의 createError 와 별도 — 단축키 실패는 silent (drawer 안에서도 동작)
      }
    }

    async function handleDelete() {
      if (!selectedMeetingId) return;
      if (deleteMeetingMutation.isPending) return;
      if (!window.confirm("이 메모를 휴지통으로 옮길까요?")) return;
      // 삭제 전 옛 list 에서 다음 메모 capture. mutate 의 onSuccess 가 cache 의 list
      // 에서 deleted 를 즉시 filter 하므로 await 후엔 idx 가 무의미 — pre-capture 필수.
      // 같은 폴더 안 → 부모 폴더 재귀 (사이드바 정렬 적용).
      const nextUid = findDeleteNeighbor(selectedMeetingId);
      try {
        await deleteMeetingMutation.mutateAsync(selectedMeetingId);
        if (nextUid) {
          openMeeting(nextUid);
        } else {
          deselectMeeting();
        }
      } catch {
        // ignore — TanStack Query mutation state 에 반영됨
      }
    }

    function moveSelection(dir: 1 | -1) {
      const list = meetings.data;
      if (!list || list.length === 0) return;
      // 메모 미선택 상태 — raw list 의 첫/마지막 (옛 동작 유지). 폴더 정보 없으니
      // 폴더 안 메커니즘 적용 불가, 진입 안내용 fallback.
      if (!selectedMeetingId) {
        openMeeting(list[dir === 1 ? 0 : list.length - 1].uid);
        return;
      }
      // 같은 폴더 안 (사이드바 정렬 적용) dir 방향만. 폴더 경계 안 넘어감 —
      // 폴더 끝이면 no-op. 옵시디안 패턴.
      const nextUid = findAdjacentInFolder(selectedMeetingId, dir);
      if (!nextUid) return;
      openMeeting(nextUid);
    }

    function onKeyDown(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      if (e.altKey) return;

      // Cmd+N: 새 메모 (textarea/input 안에서도 동작)
      if ((e.key === "n" || e.key === "N") && !e.shiftKey) {
        e.preventDefault();
        void handleCreate();
        return;
      }

      // 아래 단축키는 input/textarea 밖에서만
      if (isInTextInput(e.target)) return;

      // Cmd+Backspace/Delete: 메모 삭제
      if ((e.key === "Backspace" || e.key === "Delete") && !e.shiftKey) {
        if (!selectedMeetingId) return;
        e.preventDefault();
        void handleDelete();
        return;
      }

      // Cmd+↑/↓: 메모 이동
      if (e.key === "ArrowUp" && !e.shiftKey) {
        e.preventDefault();
        moveSelection(-1);
        return;
      }
      if (e.key === "ArrowDown" && !e.shiftKey) {
        e.preventDefault();
        moveSelection(1);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedMeetingId, meetings.data]);

  function switchTab(next: Tab) {
    setTab(next);
    // selectedMeetingId 는 보존. 메모장으로 돌아오면 그 메모가 다시 열림.
    const target =
      next === "meetings"
        ? selectedMeetingId
          ? `#meeting-${selectedMeetingId}`
          : ""
        : `#${next}`;
    if (window.location.hash !== target) {
      window.history.pushState(
        { tab: next, meetingId: selectedMeetingId },
        "",
        target || window.location.pathname,
      );
    }
  }

  function changeTab(next: Tab) {
    if (next === tab) return;
    switchTab(next);
  }

  function openMeeting(id: string) {
    drawer.close();
    setTab("meetings");
    setSelectedMeetingId(id);
    window.history.pushState({ meetingId: id }, "", `#meeting-${id}`);
  }

  // "오늘" 대시보드의 "새 노트" — root 폴더에 생성 후 메모장 탭으로 이동.
  async function createNoteFromToday() {
    if (createMeetingMutation.isPending) return;
    try {
      const created = await createMeetingMutation.mutateAsync({
        title: null,
        date: todayIso(),
        time: null,
        attendees: null,
        content: "",
        summary: null,
        folder: "",
      });
      requestMeetingReveal("");
      openMeeting(created.uid);
    } catch {
      toast.show("노트 생성에 실패했습니다. 잠시 후 다시 시도하세요.");
    }
  }

  // 일기 오버레이 열기 — 메인 "오늘 일기" (date=오늘) + 날짜 상세 모달의 일기 진입.
  function openJournal(date: string) {
    setJournalDate(date);
  }

  // "오늘" 탭에서 날짜 선택 — 메인창을 그 날 day-view 로 전환 (모달 아님).
  function openDay(date: string) {
    setSelectedDay(date);
  }

  // "오늘" 탭에 (재)진입하면 selectedDay 를 오늘로 리셋 — 다른 날을 보던 채로 탭을
  // 떠났다 돌아왔을 때 탭이 늘 "오늘"에서 시작하도록. 탭 안에서의 날짜 선택은 유지.
  useEffect(() => {
    if (tab === "today") setSelectedDay(todayIso());
  }, [tab]);

  function openTask(id: string) {
    drawer.close();
    setTab("todos");
    // 클릭한 task 가 현재 필터(cancelled view, 특정 카테고리 등) 밖이면 안 보임 →
    // 필터 reset 후 scroll. 사용자는 "그 task 로 이동" 의도가 명확.
    setTaskStatus("all");
    setSelectedProject(null);
    // 루틴 상세를 보던 중이면 일반 태스크 목록으로 빠져나와야 클릭한 task 가 보임.
    setSelectedRoutineName(null);
    setScrollToTaskId(id);
    if (window.location.hash !== "#todos") {
      window.history.pushState({ tab: "todos" }, "", "#todos");
    }
  }

  function closeMeeting() {
    if (window.history.state?.meetingId) {
      window.history.back();
    } else {
      setSelectedMeetingId(null);
    }
  }

  // 메모 선택만 해제 — 메모장 탭에 머무름. history.back() (직전 페이지로 튀는 경로)
  // 을 안 타고 hash 만 #meetings 로 pushState. 폴더의 유일한 메모를 지워 다음
  // 메모가 없을 때(삭제 경로), 사이드바 빈 공간 클릭(deselect) 둘 다 이걸 호출.
  function deselectMeeting() {
    setSelectedMeetingId(null);
    if (window.location.hash !== "#meetings") {
      window.history.pushState({ tab: "meetings", meetingId: null }, "", "#meetings");
    }
  }

  // 폴더 경로의 부모. "work/2026" → "work", "work" → "", "" → null (root 의 부모 없음).
  function parentFolderPath(folder: string): string | null {
    if (folder === "") return null;
    const idx = folder.lastIndexOf("/");
    return idx === -1 ? "" : folder.slice(0, idx);
  }

  // 삭제 직후 자동 선택할 다음 메모 uid. 옵시디안 패턴:
  //   1. 같은 폴더 안 (사이드바 정렬 적용) 다음 메모, 없으면 이전 메모
  //   2. 같은 폴더 안 다른 메모 0개면 부모 폴더의 첫 메모 (정렬 적용) — root 까지 재귀
  //   3. root 까지 다 비면 null (empty state)
  // 사이드바 sortKey 와 동일 comparator 라 사용자 시각과 일치.
  const findDeleteNeighbor = useCallback(
    (uid: string): string | null => {
      const list = meetings.data ?? [];
      const target = list.find((m) => m.uid === uid);
      if (!target) return null;
      const folder = meetingFolder(target.id);
      const inFolder = list
        .filter((m) => meetingFolder(m.id) === folder)
        .sort(meetingSortComparator);
      const idx = inFolder.findIndex((m) => m.uid === uid);
      if (idx >= 0) {
        const sibling = inFolder[idx + 1] ?? inFolder[idx - 1];
        if (sibling) return sibling.uid;
      }
      // 같은 폴더 안 다른 메모 없음 → 부모 폴더 재귀
      let parent = parentFolderPath(folder);
      while (parent !== null) {
        const inParent = list
          .filter((m) => m.uid !== uid && meetingFolder(m.id) === parent)
          .sort(meetingSortComparator);
        if (inParent.length > 0) return inParent[0].uid;
        parent = parentFolderPath(parent);
      }
      return null;
    },
    [meetings.data, meetingSortComparator],
  );

  // Cmd+↑/↓ 이동용. 같은 폴더 안 (사이드바 정렬 적용) dir 방향만. 폴더 경계 안
  // 넘어감 — 폴더 끝이면 no-op (옵시디안 패턴).
  const findAdjacentInFolder = useCallback(
    (uid: string, dir: 1 | -1): string | null => {
      const list = meetings.data ?? [];
      const target = list.find((m) => m.uid === uid);
      if (!target) return null;
      const folder = meetingFolder(target.id);
      const inFolder = list
        .filter((m) => meetingFolder(m.id) === folder)
        .sort(meetingSortComparator);
      const idx = inFolder.findIndex((m) => m.uid === uid);
      if (idx < 0) return null;
      return inFolder[idx + dir]?.uid ?? null;
    },
    [meetings.data, meetingSortComparator],
  );

  // Side panel per tab (모바일에선 drawer, 데스크탑에선 3-pane 왼쪽 컬럼).
  const sidePanel =
    tab === "today" ? (
      // "오늘" 사이드바 = 미니 월 그리드 + 다가오는 일정. 날짜 선택 시 메인창이
      // 그 날 day-view 로 전환(openDay → selectedDay). 다른 탭과 동일한 사이드바→메인.
      <TodayAgendaPanel onOpenDay={openDay} selectedDay={selectedDay} />
    ) : tab === "meetings" ? (
      <MeetingsSidePanel
        selectedId={selectedMeetingId}
        onSelect={openMeeting}
        onDeselect={deselectMeeting}
        revealPath={meetingReveal.path}
        revealNonce={meetingReveal.nonce}
        onRevealFolder={requestMeetingReveal}
        markdownHelpOpen={markdownHelpOpen}
        onMarkdownHelpClose={() => setMarkdownHelpOpen(false)}
      />
    ) : tab === "todos" ? (
      <TodosSidePanel
        statusFilter={taskStatus}
        onStatusChange={setTaskStatus}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
      />
    ) : tab === "routines" ? (
      <RoutinesSidePanel
        selectedRoutineName={selectedRoutineName}
        onSelectRoutine={setSelectedRoutineName}
      />
    ) : tab === "portfolio" ? (
      <PortfolioSidePanel
        activeFilter={portfolioFilter}
        onFilterChange={setPortfolioFilter}
        syncState={portfolioSync.state}
        onSyncRun={portfolioRunIncrementalSync}
        onSyncCancel={portfolioSync.cancel}
        onOpenInstallGuide={() => setInstallGuideOpen(true)}
        onOpenAuthGuide={() => setAuthGuideOpen(true)}
        onDismissSyncError={portfolioSync.dismissError}
      />
    ) : undefined;

  // 탭별 footer slot. 휴지통은 overlay 모달, 도메인별 분리.
  const sidePanelFooter =
    tab === "meetings" ? (
      <MeetingsSidePanelFooter
        onTrashOpen={() => setTrashOpen(true)}
        markdownHelpOpen={markdownHelpOpen}
        onMarkdownHelpToggle={() => setMarkdownHelpOpen((v) => !v)}
      />
    ) : tab === "todos" ? (
      <TodosSidePanelFooter onTrashOpen={() => setTodosTrashOpen(true)} />
    ) : tab === "routines" ? (
      <RoutinesSidePanelFooter onTrashOpen={() => setTodosTrashOpen(true)} />
    ) : tab === "portfolio" ? (
      <PortfolioSidePanelFooter
        onTrashOpen={() => setPortfolioTrashOpen(true)}
        onGuideOpen={() => setPortfolioGuideOpen(true)}
      />
    ) : undefined;

  return (
    <AppShell
      activeTab={tab}
      onTabChange={changeTab}
      sidePanel={sidePanel}
      sidePanelFooter={sidePanelFooter}
      sidebarCollapsed={sidebar.collapsed}
      onToggleSidebar={sidebar.toggle}
      onOpenSearch={() => setQuickSwitcherOpen(true)}
    >
      <PrefetchWarmup />
      {tab === "today" ? (
        <TodayPage
          selectedDay={selectedDay}
          onReturnToday={() => setSelectedDay(todayIso())}
          onOpenMeeting={openMeeting}
          onOpenTask={openTask}
          onCreateNote={() => void createNoteFromToday()}
        />
      ) : tab === "meetings" ? (
        selectedMeetingId ? (
          <MeetingForm
            // 메모 전환 시 강제 remount — titleDraft 등 useState 가 reconcile 로 옛
            // 메모의 값으로 carryover 되며 commitTitle 가 옛 title 로 mutate → 충돌
            // toast ("이미 같은 제목 'untitled'") 발사하던 race 차단. activeTab /
            // docHistory 등은 module-level cache (uid 기반) 라 remount 후 복원.
            key={selectedMeetingId}
            meetingId={selectedMeetingId}
            onBack={closeMeeting}
            onAfterDelete={(nextUid) => {
              if (nextUid) openMeeting(nextUid);
              else deselectMeeting();
            }}
            computeNextAfterDelete={findDeleteNeighbor}
          />
        ) : (
          <MeetingsEmpty count={meetings.data?.length ?? 0} loading={meetings.isLoading} />
        )
      ) : tab === "portfolio" ? (
        <PortfolioPage
          activeFilter={portfolioFilter}
          sortKey={portfolioSortKey}
          onSortKeyChange={setPortfolioSortKey}
          selectedCategory={portfolioCategoryFilter.selected}
          onCategoryChange={portfolioCategoryFilter.change}
          onSync={portfolioRunFullSync}
          syncRunning={portfolioSync.state.running}
        />
      ) : tab === "routines" ? (
        selectedRoutineName ? (
          <RoutineDetail
            name={selectedRoutineName}
            onClose={() => setSelectedRoutineName(null)}
          />
        ) : (
          <RoutinesEmpty />
        )
      ) : (
        <TasksPage
          statusFilter={taskStatus}
          projectFilter={selectedProject}
          sortKey={taskSortKey}
          onSortKeyChange={setTaskSortKey}
          scrollToTaskId={scrollToTaskId}
          onScrollHandled={() => setScrollToTaskId(null)}
        />
      )}
      <TrashModal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
      />
      <TodosTrashModal
        open={todosTrashOpen}
        onClose={() => setTodosTrashOpen(false)}
      />
      <PortfolioTrashModal
        open={portfolioTrashOpen}
        onClose={() => setPortfolioTrashOpen(false)}
      />
      <PortfolioGuideModal
        open={portfolioGuideOpen}
        onClose={() => setPortfolioGuideOpen(false)}
        onFullSyncRun={portfolioRunFullSync}
        fullSyncRunning={portfolioSync.state.running}
        onOpenInstallGuide={() => setInstallGuideOpen(true)}
        onOpenAuthGuide={() => setAuthGuideOpen(true)}
      />
      <InstallGuideModal
        open={installGuideOpen}
        onClose={() => setInstallGuideOpen(false)}
        onRetrySync={() => {
          setInstallGuideOpen(false);
          void portfolioRunIncrementalSync();
        }}
        retryRunning={portfolioSync.state.running}
      />
      <AuthGuideModal
        open={authGuideOpen}
        onClose={() => setAuthGuideOpen(false)}
        onRetrySync={() => {
          setAuthGuideOpen(false);
          void portfolioRunIncrementalSync();
        }}
        retryRunning={portfolioSync.state.running}
      />
      <QuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelect={(entry) => {
          switch (entry.domain) {
            case "meeting":
              openMeeting(entry.id);
              return;
            case "task":
              openTask(entry.id);
              return;
            case "journal":
              // 일기 = 그 날짜 일기 오버레이 바로 열기 (캘린더 탭 폐기 후 단일 진입점).
              drawer.close();
              openJournal(entry.id);
              return;
            case "portfolio":
              // 포트폴리오 탭으로 이동. 카드 정확 위치 scroll 은 follow-up (PortfolioPage
              // 가 scrollToSlug prop 받는 구조로 확장 필요).
              drawer.close();
              setTab("portfolio");
              if (window.location.hash !== "#portfolio") {
                window.history.pushState({ tab: "portfolio" }, "", "#portfolio");
              }
              return;
          }
        }}
      />
      <TaskAddModal
        open={taskAddOpen}
        onClose={() => setTaskAddOpen(false)}
        defaultType={taskAddType}
        prefill={taskAddPrefill}
      />
      <JournalOverlay
        open={journalDate !== null}
        date={journalDate ?? todayIso()}
        onClose={() => setJournalDate(null)}
      />
    </AppShell>
  );
}

// 루틴 탭 본문 — 선택된 루틴이 없을 때. 사이드바에서 루틴을 고르거나 새로 추가.
function RoutinesEmpty() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        title="루틴"
        description="왼쪽에서 루틴을 선택하거나 + 로 새 루틴을 추가하세요."
      />
    </div>
  );
}

// vault ready 직후 캘린더/포트폴리오 진입에 필요한 쿼리들을 background 로 워밍.
// 메모장 사이드바가 useMeetings 를 항상 띄워 메모장이 빠른 것과 같은 메커니즘.
// 컴포넌트 mount 는 안 함 — query cache 만 채움 → 진입 시 cache hit, 메모리 부담 0.
function PrefetchWarmup() {
  useJournals();
  useTasks();
  usePortfolioWorks();
  useManualFolders();
  return null;
}

function MeetingsEmpty({ count, loading }: { count: number; loading: boolean }) {
  // 메모 미선택이어도 헤더는 유지 — 좌측 사이드바 토글이 사라지지 않도록
  // (MeetingForm 과 같은 flex-col 레이아웃 + PageHeaderBar sticky=false).
  // body: 메모가 있는데 미선택 = 매일 보는 빈 상태라 문구 없이 앱 로고만 크게 + 연하게
  // (favicon.svg 를 mask 로 깔고 토큰 색으로 칠해 라이트/다크 적응). 메모 0개 = 첫
  // 진입이라 만들기 안내.
  const showLogo = !loading && count > 0;
  const message = loading
    ? ""
    : count === 0
      ? "아직 메모가 없어요. 메뉴에서 + 를 눌러 새 메모를 만드세요."
      : "메뉴에서 메모를 선택하세요.";
  return (
    <div className="min-h-svh lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <PageHeaderBar
        sticky={false}
        center={
          <Text variant="h4" as="h2">
            메모장
          </Text>
        }
      />
      {showLogo ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div
            aria-hidden
            style={{
              width: "11rem",
              height: "11rem",
              backgroundColor: "var(--line)",
              WebkitMaskImage: "url(/favicon.svg)",
              maskImage: "url(/favicon.svg)",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
              WebkitMaskSize: "contain",
              maskSize: "contain",
            }}
          />
        </div>
      ) : (
        <EmptyState
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          description={<Text variant="body" color="muted" as="span">{message}</Text>}
        />
      )}
    </div>
  );
}
