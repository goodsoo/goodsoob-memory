import { useState, type ReactNode } from "react";
import {
  Moon,
  Sun,
  ArrowLeft,
  Trash2,
  Check,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  BookOpen,
  HelpCircle,
  Sparkles,
  ExternalLink,
  MoreVertical,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "../components/common/Button";
import { Text } from "../components/common/Text";
import { Chip } from "../components/common/Chip";
import { Kbd } from "../components/common/Kbd";
import { Spinner } from "../components/common/Spinner";
import { Toggle } from "../components/common/Toggle";
import { Modal } from "../components/common/Modal";
import { Popover } from "../components/common/Popover";
import { EmptyState } from "../components/common/EmptyState";
import { useTheme } from "../hooks/useTheme";

// ============================================================================
// Data — src/index.css 와 DESIGN.md 의 single source 와 동기 유지.
// ============================================================================

type ColorToken = { name: string; usage: string };
type ColorGroup = { id: string; title: string; tokens: ColorToken[] };

const COLOR_GROUPS: ColorGroup[] = [
  {
    id: "bg",
    title: "1.1 Background",
    tokens: [
      { name: "--bg", usage: "body, main, modal inner" },
      { name: "--surface", usage: "card, sidebar, input" },
      { name: "--surface-2", usage: "hover 상태" },
      { name: "--surface-3", usage: "선택 / 활성" },
      { name: "--bg-overlay", usage: "header backdrop, modal overlay" },
    ],
  },
  {
    id: "frost",
    title: "1.2 Surface frost",
    tokens: [
      { name: "--surface-frost", usage: "floating panel 배경" },
      { name: "--surface-frost-border", usage: "frost 경계선" },
    ],
  },
  {
    id: "text",
    title: "1.3 Text",
    tokens: [
      { name: "--ink", usage: "본문 텍스트" },
      { name: "--sub", usage: "라벨, 메타데이터" },
      { name: "--faint", usage: "placeholder, 비활성 아이콘" },
      { name: "--text-inverse", usage: "btn-primary 위 텍스트" },
    ],
  },
  {
    id: "border",
    title: "1.4 Border",
    tokens: [
      { name: "--line", usage: "일반 구분선" },
      { name: "--line-2", usage: "약한 구분 (캘린더 셀)" },
    ],
  },
  {
    id: "accent",
    title: "1.5 Accent",
    tokens: [
      { name: "--down", usage: "에러, 오늘 마커, destructive" },
      { name: "--down-soft", usage: "에러 박스 배경" },
      { name: "--down-ink", usage: "에러 박스 텍스트" },
      { name: "--accent", usage: "primary 액션, 편집 모드" },
      { name: "--accent-soft", usage: "편집 모드 배경" },
      { name: "--accent-ink", usage: "편집 모드/info 텍스트" },
      { name: "--ok", usage: "성공 상태 (Check)" },
    ],
  },
  {
    id: "cat",
    title: "1.6 Category dots",
    tokens: [
      { name: "--cat-uiux", usage: "portfolio ui_ux" },
      { name: "--cat-backend", usage: "portfolio backend" },
      { name: "--cat-infra", usage: "portfolio infra" },
      { name: "--cat-fix", usage: "portfolio fix" },
      { name: "--cat-other", usage: "portfolio other + task 미분류" },
      { name: "--cat-work", usage: "태스크 업무" },
      { name: "--cat-schedule", usage: "태스크 일정" },
    ],
  },
  {
    id: "interactive",
    title: "1.7 Interactive",
    tokens: [
      { name: "--btn-primary", usage: "primary 버튼 배경" },
      { name: "--btn-primary-text", usage: "primary 버튼 텍스트" },
      { name: "--focus-ring", usage: "focus 표시" },
    ],
  },
];

const FONT_FAMILIES = [
  {
    name: "--font-sans",
    family: "Pretendard Variable + system fallback",
    sample: "본문 — The quick brown fox jumps over",
  },
  {
    name: "--font-serif",
    family: "Pretendard Variable (serif slot, Georgia fallback)",
    sample: "일기 — 글을 쓰는 톤",
  },
  {
    name: "--font-mono",
    family: "ui-monospace, SF Mono, Menlo",
    sample: "var(--btn-primary) / `code`",
  },
];

const TYPOGRAPHY_SCALE = [
  { sample: "메모 제목", className: "text-3xl font-bold", size: "30px", usage: "메모 제목" },
  { sample: "페이지 제목", className: "text-lg font-semibold", size: "18px", usage: "페이지 제목" },
  { sample: "사이드 패널 헤더", className: "text-sm font-semibold", size: "14px", usage: "사이드 패널 헤더" },
  { sample: "본문 텍스트", className: "text-base", size: "16px", usage: "본문" },
  { sample: "라벨 / 메타", className: "text-xs", size: "12px", usage: "라벨, 메타" },
  { sample: "캘린더 이벤트", className: "text-2xs", size: "11px", usage: "캘린더 이벤트" },
];

const SPACING = [
  { tw: "2", px: 8, usage: "아이콘 간격, 인라인 gap" },
  { tw: "3", px: 12, usage: "리스트 아이템 패딩" },
  { tw: "5", px: 20, usage: "페이지 좌우 패딩" },
  { tw: "6", px: 24, usage: "섹션 간격, 모달 wrapper padding" },
  { tw: "16", px: 64, usage: "페이지 하단 여백" },
];

const RADIUS = [
  { tw: "rounded-md", px: "6px", usage: "버튼 / 사이드바 / chip" },
  { tw: "rounded-lg", px: "8px", usage: "카드 / 모달 inner" },
  { tw: "rounded-xl", px: "12px", usage: "큰 모달" },
  { tw: "rounded-full", px: "9999px", usage: "dot / pill chip" },
];

const SHADOWS = [
  { name: "--shadow-card", usage: "일반 카드" },
  { name: "--shadow-modal", usage: "모달 wrapper" },
  { name: "--shadow-popover", usage: "팝오버 / 컨텍스트 메뉴" },
];

const OPACITIES = [
  { name: "--opacity-disabled", value: 0.4, usage: "disabled button / form" },
  { name: "--opacity-secondary", value: 0.6, usage: "secondary text / icon" },
  { name: "--opacity-overlay", value: 0.5, usage: "캘린더 dim out-of-month" },
  { name: "--opacity-hover", value: 0.9, usage: "primary button hover" },
  { name: "--opacity-active", value: 0.8, usage: "button active" },
];

const MOTION = [
  { name: "--motion-fast", value: "120ms", usage: "toggle / chip 활성 전환" },
  { name: "--motion-base", value: "150ms", usage: "일반 transition" },
  { name: "--motion-slow", value: "250ms", usage: "페이지 전환, modal mount" },
];

const Z_LAYERS = [
  { name: "--z-dropdown", value: 10, usage: "메모장 컨텍스트 메뉴" },
  { name: "--z-sticky", value: 20, usage: "사이드 패널 헤더 sticky" },
  { name: "--z-overlay", value: 30, usage: "popover / MarkdownHelpPanel" },
  { name: "--z-modal", value: 50, usage: "모든 <Modal>" },
  { name: "--z-popover", value: 55, usage: "모달 안 popover" },
  { name: "--z-tooltip", value: 60, usage: "<TooltipProvider />" },
  { name: "--z-toast", value: 70, usage: "<ToastProvider>" },
];

const LAYOUT_TOKENS = [
  { name: "--page-header-h", value: "3.25rem", usage: "페이지·앱 헤더 공통 높이 (DS §6, 상시)" },
  { name: "--safe-top/bottom/left/right", value: "env(safe-area-inset-*)", usage: "iOS notch / 홈 인디케이터" },
];

const ICONS: { icon: typeof Trash2; meaning: string }[] = [
  { icon: Trash2, meaning: "휴지통 / 영구 삭제" },
  { icon: Check, meaning: "확인 / 성공" },
  { icon: Loader2, meaning: "로딩 (animate-spin)" },
  { icon: Plus, meaning: "추가" },
  { icon: Pencil, meaning: "편집" },
  { icon: Eye, meaning: "보기 / 포함" },
  { icon: EyeOff, meaning: "숨기기 / 제외" },
  { icon: BookOpen, meaning: "가이드" },
  { icon: HelpCircle, meaning: "도움말" },
  { icon: Sparkles, meaning: "AI / Claude" },
  { icon: ExternalLink, meaning: "외부 링크" },
  { icon: MoreVertical, meaning: "메뉴" },
  { icon: X, meaning: "닫기" },
];

const BUTTON_VARIANTS = ["primary", "secondary", "danger", "info", "ghost"] as const;
const BUTTON_SIZES = ["sm", "md"] as const;

const TEXT_VARIANTS = [
  "display",
  "h1",
  "h2",
  "h3",
  "h4",
  "body",
  "caption",
  "label",
] as const;

const TEXT_COLORS = ["primary", "secondary", "muted", "danger", "info"] as const;

type WritingItem = {
  category: string;
  rule: string;
  good: string;
  bad: string;
};

const WRITING: WritingItem[] = [
  {
    category: "종결어미",
    rule: "설명문은 `~합니다` 통일. 1인 dogfood 단일 톤.",
    good: "저장에 실패했습니다.",
    bad: "저장에 실패했어요.",
  },
  {
    category: "액션 라벨",
    rule: "명사형 통일. `~하기` 형식 사용 X.",
    good: "삭제 / 저장 / 연결",
    bad: "삭제하기 / 저장하기 / 연결하기",
  },
  {
    category: "에러 메시지",
    rule: "원인 + 해결 2단. 사과 X.",
    good: "저장에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.",
    bad: "죄송합니다. 저장에 실패했습니다.",
  },
  {
    category: "날짜 형식",
    rule: "정밀: `YYYY.MM.DD`. 목록: 상대 (`5분 전`, `어제`) 또는 짧은 (`5월 23일`).",
    good: "2026.05.23 · 5분 전 · 어제",
    bad: "2026-05-23 · 2026년 5월 23일 (목록)",
  },
  {
    category: "시간 형식",
    rule: "`오전·오후 h:mm` 12시간 (소비자 톤).",
    good: "오후 3:25",
    bad: "15:25",
  },
  {
    category: "숫자 · 단위",
    rule: "천 단위 `,`. 단위 한글, 붙임 (`30분`).",
    good: "1,000 · 30분 · 1MB",
    bad: "1000 · 30 분 · 30min",
  },
  {
    category: "placeholder",
    rule: "명령형 안내 (`{필드 이름}을 입력하세요`). 예시 (`예: ...`) 형식 X — 사용자 입력값을 좁힘. 영문/축약 X.",
    good: "이름을 입력하세요 / 카테고리 이름을 입력하세요",
    bad: "예: 홍길동 / Search... / 입력",
  },
  {
    category: "empty state",
    rule: "heading + body + CTA 3단. 어미는 종결어미 정책 따름.",
    good: "메모가 없습니다 / 첫 메모를 만들어 시작하세요 / [+ 새 메모]",
    bad: "텍스트만 / 아이콘만 / heading 없이 description",
  },
  {
    category: "wrap",
    rule: "`word-break: keep-all` 전역. chip · 날짜는 `whitespace-nowrap`, 영문 URL · 해시는 `break-all`.",
    good: "긴 한글 문장이 단어 단위로 자연스럽게 줄바꿈됩니다.",
    bad: "긴-한-글-문-장-이-문-자-단-위-로-잘-림 (한글 본문)",
  },
  {
    category: "문장부호",
    rule: "한국어 본문 em dash (`—`) 금지. 쉼표 · 괄호 · 마침표 사용.",
    good: "저장에 실패했습니다. 다시 시도하세요.",
    bad: "저장에 실패했습니다 — 다시 시도하세요.",
  },
];

// ============================================================================
// UI helpers
// ============================================================================

const TOC = [
  { id: "color", label: "1. Color" },
  { id: "typography", label: "2. Typography" },
  { id: "spacing", label: "3. Spacing" },
  { id: "radius", label: "4. Radius" },
  { id: "effects", label: "5. Effects" },
  { id: "motion", label: "6. Motion" },
  { id: "z", label: "7. Z-index" },
  { id: "layout", label: "8. Layout" },
  { id: "icons", label: "9. Icons" },
  { id: "components", label: "10. Components" },
  { id: "writing", label: "11. Writing" },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function TocSidebar() {
  return (
    <aside
      className="sticky hidden shrink-0 self-start lg:block"
      style={{
        top: "2.5rem",
        width: "11rem",
      }}
    >
      <Text variant="caption" weight="semibold" color="muted" as="p" className="mb-2 px-2 uppercase tracking-wider">
        목차
      </Text>
      <nav>
        <ul className="flex flex-col gap-0.5">
          {TOC.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(item.id);
                }}
                className="block rounded-md px-2 py-1 text-sm transition hover:bg-[var(--surface-2)]"
                style={{ color: "var(--sub)" }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-14">
      <Text variant="h2" as="h2" className="mb-5">
        {title}
      </Text>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return (
    <Text variant="h4" as="h3" color="secondary" className="mb-3 mt-6 first:mt-0">
      {children}
    </Text>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-4 ${className}`}
      style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
    >
      {children}
    </div>
  );
}

function ColorSwatch({ name, usage }: ColorToken) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-md"
        style={{
          background: `var(${name})`,
          border: "1px solid var(--line)",
        }}
      />
      <div className="flex flex-col gap-0.5">
        <Text variant="caption" className="font-mono">
          {name}
        </Text>
        <Text variant="caption" color="secondary">
          {usage}
        </Text>
      </div>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export function StyleguidePage() {
  const { theme, toggle } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [toggleOn, setToggleOn] = useState(true);

  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--ink)",
        height: "100vh",
        overflowY: "auto",
        scrollPaddingTop: "1.5rem",
      }}
    >
      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-10">
        <TocSidebar />
        <main className="min-w-0 flex-1">
        {/* 헤더 */}
        <header
          className="mb-12 flex flex-wrap items-start justify-between gap-4 border-b pb-6"
          style={{ borderColor: "var(--line)" }}
        >
          <div>
            <Text variant="display" as="h1" className="mb-2">
              디자인 시스템
            </Text>
            <Text variant="body" color="secondary" as="p">
              goodsoob-work 의 토큰 · 컴포넌트 · 카피 규약. 1인 dogfood, 단일 consumer.
            </Text>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => {
                window.location.hash = "#today";
              }}
            >
              앱으로
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={
                theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )
              }
              onClick={(e) =>
                toggle({ origin: { x: e.clientX, y: e.clientY } })
              }
            >
              {theme === "dark" ? "라이트" : "다크"}
            </Button>
          </div>
        </header>

        {/* 1. Color */}
        <Section id="color" title="1. Color">
          {COLOR_GROUPS.map((g) => (
            <div key={g.id} className="mb-6">
              <SubTitle>{g.title}</SubTitle>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {g.tokens.map((t) => (
                  <ColorSwatch key={t.name} {...t} />
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* 2. Typography */}
        <Section id="typography" title="2. Typography">
          <SubTitle>2.1 Font families</SubTitle>
          <div className="flex flex-col gap-3">
            {FONT_FAMILIES.map((f) => (
              <Card key={f.name}>
                <Text variant="caption" color="muted" className="font-mono mb-1">
                  {f.name}
                </Text>
                <div style={{ fontFamily: `var(${f.name})`, fontSize: "1.25rem" }}>
                  {f.sample}
                </div>
                <Text variant="caption" color="secondary" className="mt-1">
                  {f.family}
                </Text>
              </Card>
            ))}
          </div>

          <SubTitle>2.2 Scale</SubTitle>
          <Card>
            <div className="flex flex-col gap-3">
              {TYPOGRAPHY_SCALE.map((s) => (
                <div
                  key={s.className}
                  className="flex flex-wrap items-baseline gap-4 border-b pb-3 last:border-b-0 last:pb-0"
                  style={{ borderColor: "var(--line-2)" }}
                >
                  <span className={s.className} style={{ minWidth: "12rem" }}>
                    {s.sample}
                  </span>
                  <Text variant="caption" className="font-mono">
                    {s.className}
                  </Text>
                  <Text variant="caption" color="muted">
                    {s.size} · {s.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 3. Spacing */}
        <Section id="spacing" title="3. Spacing">
          <Text variant="body" color="secondary" className="mb-4" as="p">
            8px 기반 (Tailwind 단위).
          </Text>
          <Card>
            <div className="flex flex-col gap-3">
              {SPACING.map((s) => (
                <div key={s.tw} className="flex items-center gap-4">
                  <Text variant="caption" className="font-mono w-20">
                    p/m-{s.tw}
                  </Text>
                  <div
                    className="h-3 rounded-sm"
                    style={{
                      width: `${s.px}px`,
                      background: "var(--btn-primary)",
                    }}
                  />
                  <Text variant="caption" color="muted" className="w-16">
                    {s.px}px
                  </Text>
                  <Text variant="caption" color="secondary">
                    {s.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 4. Radius */}
        <Section id="radius" title="4. Radius">
          <Card>
            <div className="flex flex-wrap gap-8">
              {RADIUS.map((r) => (
                <div key={r.tw} className="flex flex-col items-center gap-2">
                  <div
                    className={`h-16 w-16 ${r.tw}`}
                    style={{
                      background: "var(--surface-3)",
                      border: "1px solid var(--line)",
                    }}
                  />
                  <Text variant="caption" className="font-mono">
                    {r.tw}
                  </Text>
                  <Text variant="caption" color="muted">
                    {r.px}
                  </Text>
                  <Text variant="caption" color="secondary" className="text-center">
                    {r.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 5. Effects */}
        <Section id="effects" title="5. Effects">
          <SubTitle>5.1 Shadow</SubTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SHADOWS.map((s) => (
              <Card key={s.name}>
                <div
                  className="mb-3 h-16 rounded-md"
                  style={{
                    background: "var(--bg)",
                    boxShadow: `var(${s.name})`,
                  }}
                />
                <Text variant="caption" className="font-mono">
                  {s.name}
                </Text>
                <Text variant="caption" color="secondary">
                  {s.usage}
                </Text>
              </Card>
            ))}
          </div>

          <SubTitle>5.2 Opacity</SubTitle>
          <Card>
            <div className="flex flex-wrap gap-5">
              {OPACITIES.map((o) => (
                <div key={o.name} className="flex flex-col items-center gap-1">
                  <div
                    className="h-10 w-10 rounded-md"
                    style={{
                      background: "var(--btn-primary)",
                      opacity: o.value,
                    }}
                  />
                  <Text variant="caption" className="font-mono text-center">
                    {o.name}
                  </Text>
                  <Text variant="caption" color="muted">
                    {o.value}
                  </Text>
                  <Text variant="caption" color="secondary" className="max-w-[10rem] text-center">
                    {o.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 6. Motion */}
        <Section id="motion" title="6. Motion">
          <Card>
            <div className="flex flex-col gap-2">
              {MOTION.map((m) => (
                <div key={m.name} className="flex flex-wrap items-baseline gap-4">
                  <Text variant="caption" className="font-mono w-36">
                    {m.name}
                  </Text>
                  <Text variant="caption" color="muted" className="w-16">
                    {m.value}
                  </Text>
                  <Text variant="caption" color="secondary">
                    {m.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 7. Z-index */}
        <Section id="z" title="7. Z-index">
          <Text variant="body" color="secondary" className="mb-4" as="p">
            layer scale: dropdown &lt; sticky &lt; overlay &lt; modal &lt; popover &lt; tooltip &lt; toast.
          </Text>
          <Card>
            <div className="flex flex-col gap-2">
              {Z_LAYERS.map((z) => (
                <div key={z.name} className="flex flex-wrap items-baseline gap-4">
                  <Text variant="caption" className="font-mono w-36">
                    {z.name}
                  </Text>
                  <Text variant="caption" color="muted" className="w-12">
                    {z.value}
                  </Text>
                  <Text variant="caption" color="secondary">
                    {z.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 8. Layout */}
        <Section id="layout" title="8. Layout">
          <Text variant="body" color="secondary" className="mb-4" as="p">
            Desktop 3-pane: ActivityBar 48px · SidePanel 288px · Main flex-1. Breakpoint `lg`
            = 640px.
          </Text>
          <Card>
            <div className="flex flex-col gap-2">
              {LAYOUT_TOKENS.map((l) => (
                <div key={l.name} className="flex flex-wrap items-baseline gap-4">
                  <Text variant="caption" className="font-mono w-52">
                    {l.name}
                  </Text>
                  <Text variant="caption" color="muted" className="w-32">
                    {l.value}
                  </Text>
                  <Text variant="caption" color="secondary">
                    {l.usage}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 9. Icons */}
        <Section id="icons" title="9. Icon vocabulary">
          <Text variant="body" color="secondary" className="mb-4" as="p">
            lucide-react 통일. 같은 action 에 다른 아이콘 X.
          </Text>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ICONS.map(({ icon: Icon, meaning }) => (
              <Card key={meaning} className="!p-3">
                <div className="flex items-center gap-3">
                  <Icon
                    className="h-5 w-5 shrink-0"
                    style={{ color: "var(--ink)" }}
                  />
                  <Text variant="caption" color="secondary">
                    {meaning}
                  </Text>
                </div>
              </Card>
            ))}
          </div>
        </Section>

        {/* 10. Components */}
        <Section id="components" title="10. Components">
          {/* Button */}
          <SubTitle>10.1 Button</SubTitle>
          <Card>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="pb-3 text-left">
                    <Text variant="caption" color="muted">
                      variant
                    </Text>
                  </th>
                  {BUTTON_SIZES.map((s) => (
                    <th key={s} className="pb-3 text-left">
                      <Text variant="caption" color="muted">
                        size={s}
                      </Text>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BUTTON_VARIANTS.map((v) => (
                  <tr key={v}>
                    <td className="py-2 pr-3">
                      <Text variant="caption" className="font-mono">
                        {v}
                      </Text>
                    </td>
                    {BUTTON_SIZES.map((s) => (
                      <td key={s} className="py-2 pr-3">
                        <Button variant={v} size={s}>
                          {v}
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-3">
                    <Text variant="caption" className="font-mono">
                      icon
                    </Text>
                  </td>
                  <td colSpan={2} className="py-2">
                    <Button variant="icon" aria-label="삭제">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 align-top">
                    <Text variant="caption" color="muted">
                      + icon
                    </Text>
                  </td>
                  <td colSpan={2} className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
                        새 메모
                      </Button>
                      <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />}>
                        삭제
                      </Button>
                      <Button variant="secondary" disabled>
                        disabled
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* Text */}
          <SubTitle>10.2 Text</SubTitle>
          <Card>
            <Text variant="caption" color="muted" as="p" className="mb-3">
              variant
            </Text>
            <div className="mb-5 flex flex-col gap-2">
              {TEXT_VARIANTS.map((v) => (
                <div key={v} className="flex flex-wrap items-baseline gap-4">
                  <Text variant={v} as="span">
                    가나다 Ag
                  </Text>
                  <Text variant="caption" color="muted" className="font-mono">
                    variant={v}
                  </Text>
                </div>
              ))}
            </div>
            <Text variant="caption" color="muted" as="p" className="mb-3">
              color
            </Text>
            <div className="flex flex-wrap gap-4">
              {TEXT_COLORS.map((c) => (
                <Text key={c} color={c}>
                  color={c}
                </Text>
              ))}
            </div>
          </Card>

          {/* Chip */}
          <SubTitle>10.3 Chip</SubTitle>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Chip variant="default">default</Chip>
              <Chip variant="outline">outline</Chip>
              <Chip variant="accent">accent</Chip>
              <Chip variant="default" size="sm">
                sm
              </Chip>
              <Chip variant="outline" size="sm">
                sm outline
              </Chip>
              <Chip variant="default">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "var(--cat-uiux)" }}
                />
                ui_ux
              </Chip>
              <Chip variant="default">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "var(--cat-work)" }}
                />
                업무
              </Chip>
            </div>
          </Card>

          {/* Kbd */}
          <SubTitle>10.4 Kbd</SubTitle>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Kbd>Cmd</Kbd>
              <span style={{ color: "var(--faint)" }}>+</span>
              <Kbd>Shift</Kbd>
              <span style={{ color: "var(--faint)" }}>+</span>
              <Kbd>E</Kbd>
              <Text variant="caption" color="muted" className="ml-2">
                편집 / 보기 토글
              </Text>
            </div>
          </Card>

          {/* Spinner */}
          <SubTitle>10.5 Spinner</SubTitle>
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Spinner size="xs" style={{ color: "var(--sub)" }} />
                <Text variant="caption" color="muted">
                  xs
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Spinner size="sm" style={{ color: "var(--sub)" }} />
                <Text variant="caption" color="muted">
                  sm
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Spinner size="md" style={{ color: "var(--sub)" }} />
                <Text variant="caption" color="muted">
                  md (default)
                </Text>
              </div>
            </div>
          </Card>

          {/* Modal */}
          <SubTitle>10.6 Modal</SubTitle>
          <Card>
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={() => setModalOpen(true)}>
                모달 열기
              </Button>
              <Text variant="caption" color="muted">
                backdrop click / Esc 로 닫힘
              </Text>
            </div>
          </Card>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            ariaLabel="예시 모달"
            size="md"
          >
            <div
              className="w-full max-w-md rounded-xl p-6"
              style={{
                background: "var(--bg)",
                boxShadow: "var(--shadow-modal)",
                border: "1px solid var(--line)",
              }}
            >
              <Text variant="h3" as="h2" className="mb-2">
                예시 모달
              </Text>
              <Text variant="body" color="secondary" as="p" className="mb-5">
                backdrop click 또는 Esc 로 닫힙니다. dismissOnEscape 와
                dismissOnBackdrop 으로 confirm 중첩 케이스 분기 가능합니다.
              </Text>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModalOpen(false)}>
                  취소
                </Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>
                  확인
                </Button>
              </div>
            </div>
          </Modal>

          {/* Popover */}
          <SubTitle>10.7 Popover</SubTitle>
          <Card>
            <div className="flex items-center gap-3">
              <Popover
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
                trigger={
                  <Button
                    variant="secondary"
                    rightIcon={<MoreVertical className="h-4 w-4" />}
                    onClick={() => setPopoverOpen((v) => !v)}
                  >
                    팝오버 열기
                  </Button>
                }
                panelClassName="absolute left-0 top-full mt-1 w-44 rounded-md p-1"
                panelStyle={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  boxShadow: "var(--shadow-popover)",
                  zIndex: "var(--z-popover)" as unknown as number,
                }}
              >
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                  style={{ color: "var(--ink)" }}
                  onClick={() => setPopoverOpen(false)}
                >
                  옵션 1
                </button>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                  style={{ color: "var(--ink)" }}
                  onClick={() => setPopoverOpen(false)}
                >
                  옵션 2
                </button>
              </Popover>
              <Text variant="caption" color="muted">
                외부 클릭 / Esc 로 닫힘
              </Text>
            </div>
          </Card>

          {/* EmptyState */}
          <SubTitle>10.8 EmptyState</SubTitle>
          <Card className="!p-0">
            <EmptyState
              icon={
                <BookOpen
                  className="h-12 w-12"
                  style={{ color: "var(--faint)" }}
                  strokeWidth={1.25}
                />
              }
              title="메모가 없습니다"
              description="첫 메모를 만들어 시작하세요."
              action={
                <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
                  새 메모
                </Button>
              }
            />
          </Card>

          {/* Error states — Toast / EmptyState / Danger zone 3 패턴 */}
          <SubTitle>10.9 에러 표현</SubTitle>
          <Text variant="body" color="secondary" as="p" className="mb-4">
            inline 빨간 박스 패턴 폐기. 의미별 3 패턴으로 분리.
          </Text>

          <Card className="mb-3">
            <Text variant="caption" weight="semibold" as="p" className="mb-2">
              (a) Transient 에러 → Toast
            </Text>
            <Text variant="caption" color="muted" as="p" className="mb-3">
              사용자 트리거 작업 (저장, 동기화 등) 실패. `useToast().show(...)` 호출.
              voice/tone: 원인 + 해결 2단.
            </Text>
            <div
              className="inline-flex items-center rounded-md px-3 py-2 text-xs"
              style={{
                background: "var(--surface-frost)",
                border: "1px solid var(--surface-frost-border)",
                color: "var(--ink)",
                backdropFilter: "blur(12px)",
              }}
            >
              동기화에 실패했습니다. 네트워크 연결을 확인하세요.
            </div>
          </Card>

          <Card className="mb-3 !p-0">
            <div className="px-4 pt-4">
              <Text variant="caption" weight="semibold" as="p" className="mb-2">
                (b) 영구 load 실패 → EmptyState + AlertCircle
              </Text>
              <Text variant="caption" color="muted" as="p" className="mb-3">
                목록/메모 자체 fetch 실패 — 데이터 안 보이는 영구 상태. `EmptyState`
                의 icon 자리에 빨간 AlertCircle + action 에 "다시 시도".
              </Text>
            </div>
            <EmptyState
              icon={
                <AlertCircle
                  className="h-12 w-12"
                  style={{ color: "var(--down)" }}
                  strokeWidth={1.25}
                />
              }
              title="목록을 불러오지 못했습니다"
              description="잠시 후 다시 시도하세요."
              action={<Button variant="primary">다시 시도</Button>}
            />
          </Card>

          <Card>
            <Text variant="caption" weight="semibold" as="p" className="mb-2">
              (c) Danger zone (destructive 영역)
            </Text>
            <Text variant="caption" color="muted" as="p" className="mb-3">
              `1px solid var(--down)` 전체 border + 텍스트 `--down`.
              자리: `VaultSection` disconnect, `BackupSection` wipe.
            </Text>
            <div
              className="rounded-md p-3"
              style={{
                border: "1px solid var(--down)",
                color: "var(--down)",
              }}
            >
              <Text variant="caption" weight="semibold" as="p" className="mb-1" style={{ color: "var(--down)" }}>
                Vault 연결 해제
              </Text>
              <Text variant="caption" as="p" style={{ color: "var(--down)" }}>
                연결을 끊으면 다시 폴더를 선택해야 합니다.
              </Text>
            </div>
          </Card>

          {/* Toggle */}
          <SubTitle>10.10 Toggle</SubTitle>
          <Text variant="body" color="secondary" as="p" className="mb-4">
            on/off 스위치. `role="switch"` + 키보드(Space/Enter). on=`--btn-primary`
            트랙, knob 은 `--surface` + 그림자. 설정의 on/off 항목에 사용.
          </Text>
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Toggle checked={toggleOn} onChange={setToggleOn} ariaLabel="데모 토글" />
                <Text variant="caption" color="muted">
                  {toggleOn ? "켜짐" : "꺼짐"} (클릭)
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={false} onChange={() => {}} ariaLabel="꺼짐 예시" />
                <Text variant="caption" color="muted">
                  off
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Toggle size="sm" checked onChange={() => {}} ariaLabel="작은 토글 예시" />
                <Text variant="caption" color="muted">
                  sm
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked disabled onChange={() => {}} ariaLabel="비활성 예시" />
                <Text variant="caption" color="muted">
                  disabled
                </Text>
              </div>
            </div>
          </Card>
        </Section>

        {/* 11. Writing — voice & tone */}
        <Section id="writing" title="11. Writing — voice & tone">
          <Text variant="body" color="secondary" className="mb-4" as="p">
            카피 작성 9 카테고리 default. 1주차 lock-in — 자세한 근거는 CLAUDE.md.
          </Text>
          <div className="flex flex-col gap-4">
            {WRITING.map((w) => (
              <Card key={w.category}>
                <Text variant="h4" as="h3" className="mb-1">
                  {w.category}
                </Text>
                <Text variant="caption" color="secondary" as="p" className="mb-3">
                  {w.rule}
                </Text>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div
                    className="rounded-md p-3"
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--ok)" }}
                      />
                      <Text variant="caption" weight="semibold" color="secondary" as="span">
                        권장
                      </Text>
                    </div>
                    <Text variant="caption" as="p">
                      {w.good}
                    </Text>
                  </div>
                  <div
                    className="rounded-md p-3"
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--faint)" }}
                      />
                      <Text variant="caption" weight="semibold" color="muted" as="span">
                        회피
                      </Text>
                    </div>
                    <Text variant="caption" color="secondary" as="p">
                      {w.bad}
                    </Text>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <footer
          className="border-t pt-6"
          style={{ borderColor: "var(--line)" }}
        >
          <Text variant="caption" color="muted" as="p">
            정의 source: <code className="font-mono">src/index.css</code> ·{" "}
            <code className="font-mono">DESIGN.md</code> ·{" "}
            <code className="font-mono">src/components/common/*</code>
          </Text>
          <Text variant="caption" color="muted" as="p" className="mt-1">
            새 컴포넌트는 이 페이지에 항목 추가 후 production 진입.
          </Text>
        </footer>
        </main>
      </div>
    </div>
  );
}
