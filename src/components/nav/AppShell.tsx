import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Sun,
  Moon,
  Menu,
  Settings,
  Search,
  ChevronDown,
  Check,
} from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import {
  useSidePanelWidth,
  SIDE_PANEL_MIN,
  SIDE_PANEL_MAX,
} from "../../hooks/useSidePanelWidth";
import { useDrawer } from "../../hooks/useDrawer";
import { isTauri } from "../../lib/isTauri";
import { SidebarToggleProvider } from "../../hooks/sidebarToggle";
import { formatClockNow } from "../../lib/dates";
import { useVault } from "../../lib/vault/useVault";
import { SettingsModal } from "../settings/SettingsModal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Popover } from "../common/Popover";
import { BottomTabs, TABS, type Tab } from "./BottomTabs";
import { SyncIndicator } from "./SyncIndicator";

const MOBILE_DRAWER_WIDTH = 288;
const SWIPE_CLOSE_THRESHOLD = 60;

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  sidePanel?: ReactNode;
  // SidePanel column 의 footer 왼쪽에 들어가는 페이지별 액션 (예: 메모장의 도움말/휴지통).
  // 비워두면 footer 에 theme toggle 만 보임.
  sidePanelFooter?: ReactNode;
  // 데스크탑 SidePanel collapse 상태. true = 사이드바 숨김 + main 이 윈도우 전체.
  // 옵시디안 패턴 — Cmd+\ 단축키로 토글, useSidebarCollapsed 가 관리.
  sidebarCollapsed?: boolean;
  // 사이드바 collapse 토글 — 사이드바 상단 닫기 버튼 / collapse 시 타이틀바 열기 버튼.
  // Cmd+\ 단축키와 같은 동작 (App.tsx 의 useSidebarCollapsed.toggle).
  onToggleSidebar?: () => void;
  // 타이틀바 우측 검색 버튼 클릭 시 호출 — App.tsx 의 QuickSwitcher 를 open.
  // 단축키 Cmd+P 와 같은 동작, 데스크탑/모바일 양쪽 헤더에 노출.
  onOpenSearch?: () => void;
  children: ReactNode;
};

export function AppShell({
  activeTab,
  onTabChange,
  sidePanel,
  sidePanelFooter,
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenSearch,
  children,
}: Props) {
  const { theme, toggle } = useTheme();
  const { width, setWidth } = useSidePanelWidth();
  const drawer = useDrawer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSidePanel = sidePanel != null;
  const desktopSidePanelVisible = hasSidePanel && !sidebarCollapsed;
  const ThemeIcon = theme === "light" ? Sun : Moon;

  const mainPaddingLeft = desktopSidePanelVisible ? `${width}px` : "0px";

  // BottomTab 변경 시 drawer 자동 닫기
  function handleTabChange(next: Tab) {
    drawer.close();
    onTabChange(next);
  }

  // Body scroll lock + ESC close + sidePanel 사라지면 자동 close
  useEffect(() => {
    if (!drawer.isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") drawer.close();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer]);

  useEffect(() => {
    if (!hasSidePanel && drawer.isOpen) drawer.close();
  }, [hasSidePanel, drawer]);

  // Swipe-left to close
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef(0);

  function onDrawerTouchStart(e: React.TouchEvent) {
    touchStartXRef.current = e.touches[0].clientX;
    touchDeltaXRef.current = 0;
  }
  function onDrawerTouchMove(e: React.TouchEvent) {
    if (touchStartXRef.current === null) return;
    touchDeltaXRef.current = e.touches[0].clientX - touchStartXRef.current;
  }
  function onDrawerTouchEnd() {
    if (touchDeltaXRef.current < -SWIPE_CLOSE_THRESHOLD) drawer.close();
    touchStartXRef.current = null;
    touchDeltaXRef.current = 0;
  }

  return (
    <div
      className="min-h-svh"
      style={{ paddingTop: "var(--safe-top)", backgroundColor: "var(--bg)" }}
    >
      {/* 데스크탑 윈도우 헤더 — 탭 4개 + 시계 + 우측 버튼. */}
      <header
        className="flex items-stretch"
        style={{
          position: "fixed",
          top: "var(--safe-top)",
          left: 0,
          right: 0,
          height: "var(--header-h)",
          backgroundColor: "var(--line)",
          borderBottom: "1px solid var(--line)",
          zIndex: 50,
          gap: "0.5rem",
        }}
      >
        {/* 좁은 창: 사이드바 드로어 토글 (데스크탑은 사이드바 상시 노출이라 lg 에선 숨김). */}
        {hasSidePanel ? (
          <Button
            variant="icon"
            onClick={drawer.toggle}
            aria-label="메뉴 열기"
            aria-expanded={drawer.isOpen}
            className="shrink-0 self-center lg:hidden"
            style={{ color: "var(--sub)" }}
          >
            <Menu className="h-4 w-4" />
          </Button>
        ) : null}
        {desktopSidePanelVisible ? (
          <div
            className="hidden shrink-0 items-center lg:flex"
            style={{
              width: `${width}px`,
              paddingRight: "0.5rem",
            }}
          >
            <VaultBadge onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        ) : null}
        <div className="flex h-full items-stretch">
          <HeaderTabs activeTab={activeTab} onTabChange={onTabChange} />
        </div>
        {/* 가운데 flex-1 스페이서 — live 시계(날짜·시간)는 좁은 창에선 숨김. */}
        <div className="hidden flex-1 items-center justify-center lg:flex">
          <TitlebarClock />
        </div>
        {/* 좁은 창에선 시계가 빠지므로 우측 버튼이 끝으로 가게 flex-1 스페이서. */}
        <div className="flex-1 lg:hidden" />
        {/* 우측: sync + search + settings + theme. */}
        <div className="flex items-center gap-0.5 pr-2">
          <SyncIndicator />
          {onOpenSearch ? (
            <Button
              variant="icon"
              onClick={() => onOpenSearch()}
              title="검색 (⌘P)"
              aria-label="검색"
              style={{ color: "var(--sub)" }}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            variant="icon"
            onClick={() => setSettingsOpen(true)}
            title="설정"
            aria-label="설정"
            style={{ color: "var(--sub)" }}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="icon"
            onClick={(e) => toggle({ origin: { x: e.clientX, y: e.clientY } })}
            title={theme === "light" ? "다크 모드로" : "라이트 모드로"}
            style={{ color: "var(--sub)" }}
          >
            <ThemeIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Desktop: Side Panel (상단 탭 row + sidePanel + 하단 테마 토글) */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex">
        {desktopSidePanelVisible ? (
          <div
            className="relative"
            style={{
              width: `${width}px`,
              backgroundColor: "var(--surface)",
              borderRight: "1px solid var(--line)",
            }}
          >
            <div
              className="flex h-full flex-col"
              style={{ paddingTop: "var(--header-h)" }}
            >
              <div className="relative min-h-0 flex-1">{sidePanel}</div>
              {sidePanelFooter ? (
                <div
                  className="flex shrink-0 items-center px-3 py-2"
                  style={{ borderTop: "1px solid var(--line-2)" }}
                >
                  <div className="flex min-w-0 items-center">{sidePanelFooter}</div>
                </div>
              ) : null}
            </div>
            <SidePanelResizer width={width} onChange={setWidth} />
          </div>
        ) : null}
      </div>

      {/* Mobile drawer: dim overlay + sliding aside */}
      {hasSidePanel ? (
        <>
          <div
            className={`fixed inset-0 z-30 transition-opacity lg:hidden ${
              drawer.isOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={drawer.close}
            aria-hidden
          />
          <aside
            onTouchStart={onDrawerTouchStart}
            onTouchMove={onDrawerTouchMove}
            onTouchEnd={onDrawerTouchEnd}
            className={`fixed inset-y-0 left-0 z-40 transition-transform lg:hidden ${
              drawer.isOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            style={{
              width: `${MOBILE_DRAWER_WIDTH}px`,
              backgroundColor: "var(--surface)",
              borderRight: "1px solid var(--line)",
              // 항상 떠있는 헤더바 아래로 드로어 내용이 시작하게 inset 확보.
              paddingTop: "calc(var(--safe-top) + var(--header-h))",
            }}
            aria-hidden={!drawer.isOpen}
          >
            {sidePanel}
          </aside>
        </>
      ) : null}

      {/* Main content — desktop 에선 자체 scroll container (스크롤바가 viewport
          전체가 아니라 main 안에만 표시). sticky header/tab row 도 main scroll 기준. */}
      <main
        key={activeTab}
        style={
          {
            // 하단 탭을 숨겨 더는 72px 여백이 필요 없음 — safe-area 만.
            paddingBottom: "var(--safe-bottom)",
            ["--gs-main-pl" as string]: mainPaddingLeft,
            ["--gs-main-pt" as string]: "var(--header-h)",
          } as React.CSSProperties
        }
        className="[padding-top:var(--gs-main-pt)] lg:!pb-0 lg:h-screen lg:overflow-y-auto lg:overscroll-none lg:[padding-left:var(--gs-main-pl)]"
      >
        <SidebarToggleProvider
          value={
            onToggleSidebar
              ? { collapsed: sidebarCollapsed, toggle: onToggleSidebar }
              : null
          }
        >
          {children}
        </SidebarToggleProvider>
      </main>

      {/* 하단 탭 — 좁은 창에서도 타이틀바 탭이 그대로 보이므로 중복 제거(숨김). */}
      <div className="hidden">
        <BottomTabs activeTab={activeTab} onTabChange={handleTabChange} />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function SidePanelResizer({
  width,
  onChange,
}: {
  width: number;
  onChange: (next: number) => void;
}) {
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      onChange(e.clientX);
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onChange]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onDoubleClick() {
    onChange(288);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDE_PANEL_MIN}
      aria-valuemax={SIDE_PANEL_MAX}
      onMouseDown={startDrag}
      onDoubleClick={onDoubleClick}
      title="드래그하여 너비 조절 (더블클릭 = 기본값)"
      className="group absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize"
    >
      <div
        className="ml-auto h-full transition"
        style={{
          width: "1px",
          backgroundColor: "transparent",
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-1 opacity-0 transition group-hover:opacity-60 group-active:opacity-100"
        style={{ backgroundColor: "var(--btn-primary)" }}
      />
    </div>
  );
}

// 윈도우 헤더 안의 4개 탭 아이콘 (가로 row, traffic lights 옆).
// active 탭은 folder tab pattern — main 영역 색으로 빠져나와 헤더 borderBottom 을
// -1px 넘어가서 시각적으로 main 콘텐츠와 이어짐. Chrome tab strip / 옵시디안 패턴.
function HeaderTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  return (
    <nav className="flex h-full items-end gap-0.5" aria-label="primary">
      {TABS.map(({ id, label, icon: Icon }, i) => {
        const active = id === activeTab;
        const title = isTauri ? `${label}  ⌘${i + 1}` : label;
        return (
          <Button
            key={id}
            variant="ghost"
            onClick={() => onTabChange(id)}
            aria-current={active ? "page" : undefined}
            title={title}
            aria-label={label}
            className="h-7 gap-1.5 px-2 rounded-none"
            style={{
              backgroundColor: active ? "var(--bg)" : "transparent",
              color: active ? "var(--ink)" : "var(--sub)",
              marginBottom: active ? "-1px" : 0,
              border: "1px solid transparent",
              borderTopLeftRadius: active ? 6 : 4,
              borderTopRightRadius: active ? 6 : 4,
              borderBottomLeftRadius: active ? 0 : 4,
              borderBottomRightRadius: active ? 0 : 4,
              boxSizing: "border-box",
              // tab active 전환은 즉시 — border/bg/radius 150ms 페이드가 "살짝 내려옴"
              // 처럼 보이던 거 제거.
              transition: "none",
            }}
          >
            <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.5} />
          </Button>
        );
      })}
    </nav>
  );
}

// 타이틀바 중앙 live 시계 — 날짜 + 12시간 시각. 1초 tick 으로 갱신하되 분 단위
// 라벨이 바뀔 때만 setState → 분이 넘어가는 순간 정확히 flip, 불필요한 re-render 없음.
function TitlebarClock() {
  const [label, setLabel] = useState(() => formatClockNow());

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = formatClockNow();
      setLabel((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Text
      variant="caption"
      color="secondary"
      as="span"
      className="pointer-events-none select-none whitespace-nowrap tabular-nums"
    >
      {label}
    </Text>
  );
}

// 윈도우 헤더 좌측의 vault 이름 chip — 클릭 시 dropdown 진입점.
// 항목: vault 목록 (라디오 전환) → "Vault 설정" → "스타일가이드".
// vault > tabs 시각 계층 명시 — vault 가 root container 임을 좌→우 순서로 표현.
function VaultBadge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { vaultRoot, vaults, activeVaultId, switchVault } = useVault();
  const [open, setOpen] = useState(false);
  if (!vaultRoot) return null;
  const activeName =
    vaults.find((v) => v.id === activeVaultId)?.name ??
    vaultRoot.split("/").filter(Boolean).pop() ??
    vaultRoot;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <Button
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          title={vaultRoot}
          aria-label={`vault: ${activeName}`}
          className="h-7 max-w-full gap-1 px-2 text-sm"
          style={{ color: "var(--ink)" }}
        >
          <span className="truncate">{activeName}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      }
      panelClassName="absolute left-0 top-full mt-1 w-60 rounded-md p-1"
      panelStyle={{
        background: "var(--bg)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-popover)",
        zIndex: 30,
      }}
    >
      {/* vault 목록 — 라디오. active 행에 체크. */}
      <div className="max-h-64 overflow-y-auto">
        {vaults.map((v) => {
          const active = v.id === activeVaultId;
          return (
            <button
              key={v.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
              style={{ color: "var(--ink)" }}
              onClick={async () => {
                if (!active) await switchVault(v.id);
                setOpen(false);
              }}
              title={v.path}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {active ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
            </button>
          );
        })}
      </div>
      <div
        className="my-1 h-px"
        style={{ background: "var(--line-2)" }}
        aria-hidden
      />
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
        style={{ color: "var(--ink)" }}
        onClick={() => {
          setOpen(false);
          onOpenSettings();
        }}
      >
        Vault 설정
      </button>
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
        style={{ color: "var(--ink)" }}
        onClick={() => {
          setOpen(false);
          window.location.hash = "#styleguide";
        }}
      >
        스타일가이드
      </button>
    </Popover>
  );
}
