import { useEffect, useRef, useState } from "react";
import { Sparkles, Clipboard, Check, RotateCw, X } from "lucide-react";
import {
  buildClaudePrompt,
  SUMMARY_TEMPLATES,
  DEFAULT_SUMMARY_TEMPLATE_ID,
  type PromptInput,
} from "../../lib/clipboardPrompt";
import {
  runClaudeStream,
  type ClaudeStreamController,
} from "../../lib/portfolio/claude";
import { ClipPromptButton } from "../common/ClipPromptButton";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Spinner } from "../common/Spinner";
import { MarkdownView } from "./MarkdownView";

// 요약하기 모달 — 한 오버레이 안에 [자동 요약] / [직접 붙여넣기] 두 탭.
// 자동: "요약 생성" 클릭 시 claude CLI 스트리밍 호출(진행률 표시) → 응답 → [적용].
//   모달 열림 ≠ 호출 (붙여넣기를 원할 때 헛호출 방지). stream-json 으로 경과시간 +
//   도착 글자/토큰 라이브 표시 (PR #57 의 runClaudeStream 통합).
// 붙여넣기: 프롬프트 복사 → 외부 Claude → 응답 paste → [적용].
// 둘 다 응답 텍스트를 통째 summary 에 박음 (파싱 X).

type Tab = "auto" | "paste";

type Props = {
  open: boolean;
  onClose: () => void;
  promptInput: PromptInput;
  onApply: (summary: string) => void;
};

type Stats = {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
};

// "claude-sonnet-4-6" → "sonnet-4-6" (claude- 접두사만 떼서 간결하게).
function shortModel(model?: string): string | null {
  if (!model) return null;
  return model.replace(/^claude-/, "");
}

// 40초 넘게 걸리면 "느린 게 정상일 수 있다"는 안내를 띄울 임계.
const SLOW_HINT_MS = 40_000;

// 템플릿 선택은 전역 last-used (메모별 X — v1). 사이드바 정렬(goodsoob:meetingSort)과
// 동일한 localStorage 캐시 패턴.
const TEMPLATE_STORAGE_KEY = "goodsoob:summaryTemplate";

function loadTemplateId(): string {
  try {
    const v = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (v && SUMMARY_TEMPLATES.some((t) => t.id === v)) return v;
  } catch {
    // localStorage 접근 불가 — default 로.
  }
  return DEFAULT_SUMMARY_TEMPLATE_ID;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SummaryModal({ open, onClose, promptInput, onApply }: Props) {
  const [tab, setTab] = useState<Tab>("auto");

  // 템플릿 선택 — 자동 요약·붙여넣기 두 탭 공통 (프롬프트 자체를 바꾸므로).
  const [templateId, setTemplateId] = useState<string>(loadTemplateId);

  // 자동 요약 탭 상태. 호출은 "요약 생성" 버튼 클릭으로만.
  const [requesting, setRequesting] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const [liveTokens, setLiveTokens] = useState<number | undefined>(undefined);
  const [liveModel, setLiveModel] = useState<string | undefined>(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const controllerRef = useRef<ClaudeStreamController | null>(null);
  const startRef = useRef(0);

  // 직접 붙여넣기 탭 상태
  const [raw, setRaw] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // 닫힐 때 진행 중 프로세스 kill + 전체 reset.
  useEffect(() => {
    if (open) return;
    void controllerRef.current?.cancel();
    controllerRef.current = null;
    setTab("auto");
    setRequesting(false);
    setAutoError(null);
    setSuggestion(null);
    setChars(0);
    setLiveTokens(undefined);
    setLiveModel(undefined);
    setElapsedMs(0);
    setStats(null);
    setRaw("");
    setPasteError(null);
  }, [open]);

  // 경과시간 tick — 요청 중일 때만 200ms 마다 갱신.
  useEffect(() => {
    if (!requesting) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [requesting]);

  // 칩 변경 → localStorage 저장. 자동 요약 결과가 이미 있으면 형식이 달라지므로
  // suggestion·진행 표시 일체 reset (stale "출력 N자" 잔재 방지). 진행 중엔 disable.
  function changeTemplate(id: string) {
    if (requesting || id === templateId) return;
    setTemplateId(id);
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, id);
    } catch {
      // 저장 실패해도 세션 내 선택은 유지.
    }
    setSuggestion(null);
    setStats(null);
    setChars(0);
    setLiveTokens(undefined);
    setLiveModel(undefined);
    setElapsedMs(0);
    setAutoError(null);
  }

  async function runAuto() {
    setRequesting(true);
    setAutoError(null);
    setSuggestion(null);
    setChars(0);
    setLiveTokens(undefined);
    setLiveModel(undefined);
    setStats(null);
    startRef.current = Date.now();
    setElapsedMs(0);

    const ctrl = runClaudeStream(buildClaudePrompt(promptInput, templateId), (p) => {
      setChars(p.chars);
      if (p.outputTokens != null) setLiveTokens(p.outputTokens);
      if (p.model) setLiveModel(p.model);
    });
    controllerRef.current = ctrl;

    try {
      const res = await ctrl.done;
      if (controllerRef.current !== ctrl) return; // 닫혔거나 재요청으로 교체됨
      const msg = res.stderr || (res.errored ? res.text : "");
      if (res.code !== 0 || res.errored || !res.text) {
        if (/not found|command not found/i.test(msg)) {
          throw new Error(
            "자동 요약은 이 컴퓨터에 설치된 Claude(Claude Code)로 실행됩니다.\n" +
              "Claude 를 찾지 못했습니다. 터미널에서 Claude Code 를 설치하고 `claude` 로 로그인한 뒤 다시 시도하세요.\n" +
              "지금 바로 요약하려면 위 [직접 붙여넣기] 탭을 사용하세요.",
          );
        }
        if (/auth|login|unauthor/i.test(msg)) {
          throw new Error(
            "Claude 로그인이 필요합니다.\n" +
              "터미널에서 `claude` 를 실행해 로그인한 뒤 다시 시도하세요.\n" +
              "지금 바로 요약하려면 위 [직접 붙여넣기] 탭을 사용하세요.",
          );
        }
        if (!res.text) {
          throw new Error(msg.trim() || "응답이 비어있습니다.");
        }
        throw new Error(msg.trim() || "claude CLI 실행 실패");
      }
      setSuggestion(res.text);
      setStats({
        durationMs: res.durationMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        model: res.model,
      });
    } catch (err) {
      if (controllerRef.current !== ctrl) return;
      setAutoError(err instanceof Error ? err.message : String(err));
    } finally {
      if (controllerRef.current === ctrl) {
        controllerRef.current = null;
        setRequesting(false);
      }
    }
  }

  async function cancelAuto() {
    const ctrl = controllerRef.current;
    controllerRef.current = null;
    setRequesting(false);
    await ctrl?.cancel();
  }

  function applyAuto() {
    if (!suggestion) return;
    onApply(suggestion);
    onClose();
  }

  function applyPaste() {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      setPasteError("응답을 붙여넣은 후 적용하세요.");
      return;
    }
    onApply(trimmed);
    onClose();
  }

  const activeTemplate =
    SUMMARY_TEMPLATES.find((t) => t.id === templateId) ?? SUMMARY_TEMPLATES[0];

  const tokenLabel = liveTokens != null ? `${liveTokens.toLocaleString()}토큰` : null;
  const liveModelLabel = shortModel(liveModel);
  const statsModelLabel = shortModel(stats?.model);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      maxWidth="max-w-lg"
      ariaLabel="요약하기"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* header + tab nav */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-5 pt-5">
            <Text variant="h3" as="h2" weight="semibold">
              요약하기
            </Text>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              leftIcon={<X className="h-4 w-4" />}
              className="px-1.5 py-1"
              aria-label="닫기"
            />
          </div>
          <div
            className="mt-3 flex gap-1 px-5"
            style={{ borderBottom: "1px solid var(--line-2)" }}
          >
            <TabBtn
              label="자동 요약"
              icon={<Sparkles className="h-3.5 w-3.5" />}
              active={tab === "auto"}
              onClick={() => setTab("auto")}
            />
            <TabBtn
              label="직접 붙여넣기"
              icon={<Clipboard className="h-3.5 w-3.5" />}
              active={tab === "paste"}
              onClick={() => setTab("paste")}
            />
          </div>
          {/* 템플릿 칩 row — 두 탭 공통 (프롬프트 출력 형식 전환) */}
          <div className="flex flex-wrap items-center gap-1.5 px-5 pt-3">
            <Text variant="caption" color="muted" as="span" className="mr-0.5">
              템플릿
            </Text>
            {SUMMARY_TEMPLATES.map((t) => (
              <TemplateChip
                key={t.id}
                label={t.label}
                active={t.id === templateId}
                disabled={requesting}
                onClick={() => changeTemplate(t.id)}
              />
            ))}
          </div>
          {activeTemplate ? (
            <Text variant="caption" color="muted" as="p" className="px-5 pt-1.5">
              {activeTemplate.description}
            </Text>
          ) : null}
        </div>

        {/* 자동 요약 탭 */}
        {tab === "auto" ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <Text variant="caption" color="muted" as="p">
                구독 사용량으로 호출합니다. 본인 머신의 <code>claude</code> CLI 가
                필요합니다.
              </Text>

              {!requesting && !suggestion && !autoError ? (
                <Text variant="body" color="secondary" as="p">
                  ‘요약 생성’ 을 누르면 Claude 가 메모와 음성 기록을 요약합니다.
                </Text>
              ) : null}

              {requesting ? (
                <div
                  className="flex flex-col gap-1.5 rounded-md p-3"
                  style={{ backgroundColor: "var(--surface)" }}
                >
                  <div className="flex items-center gap-2">
                    <Spinner size="md" />
                    <Text variant="body" color="secondary">
                      Claude 가 작성 중…
                    </Text>
                    <Text
                      variant="body"
                      color="secondary"
                      className="ml-auto tabular-nums"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatElapsed(elapsedMs)}
                    </Text>
                  </div>
                  <Text variant="caption" color="muted" as="div">
                    {liveModelLabel ? `${liveModelLabel} · ` : ""}
                    출력 {chars.toLocaleString()}자
                    {tokenLabel ? ` · ${tokenLabel}` : ""}
                  </Text>
                  {elapsedMs > SLOW_HINT_MS ? (
                    <Text variant="caption" color="muted" as="div">
                      예상보다 오래 걸리고 있습니다. 입력이 길면 더 걸릴 수 있습니다.
                    </Text>
                  ) : null}
                </div>
              ) : null}

              {autoError ? (
                <Text
                  variant="caption"
                  as="div"
                  className="rounded-md px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line"
                  style={{
                    backgroundColor: "var(--down-soft)",
                    color: "var(--down-ink)",
                  }}
                >
                  {autoError}
                </Text>
              ) : null}

              {suggestion ? (
                <div className="flex flex-col gap-2">
                  {stats ? (
                    <Text variant="caption" color="muted" as="div">
                      완료
                      {statsModelLabel ? ` · ${statsModelLabel}` : ""}
                      {stats.durationMs != null
                        ? ` · ${Math.round(stats.durationMs / 1000)}초`
                        : ""}
                      {stats.inputTokens != null
                        ? ` · 입력 ${stats.inputTokens.toLocaleString()}토큰`
                        : ""}
                      {stats.outputTokens != null
                        ? ` · 출력 ${stats.outputTokens.toLocaleString()}토큰`
                        : ""}
                    </Text>
                  ) : null}
                  <div
                    className="rounded-md p-3"
                    style={{
                      backgroundColor: "var(--surface-2)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <MarkdownView content={suggestion} />
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: "1px solid var(--line-2)" }}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={onClose}
                className="px-2.5 py-1"
              >
                닫기
              </Button>
              {requesting ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={cancelAuto}
                  leftIcon={<X className="h-3.5 w-3.5" />}
                  className="px-2.5 py-1"
                >
                  중지
                </Button>
              ) : suggestion ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={runAuto}
                    leftIcon={<RotateCw className="h-3.5 w-3.5" />}
                    className="px-2.5 py-1"
                  >
                    다시 요청
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={applyAuto}
                    leftIcon={<Check className="h-3.5 w-3.5" />}
                    className="px-3 py-1"
                  >
                    적용
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={runAuto}
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  className="px-3 py-1"
                >
                  {autoError ? "다시 요청" : "요약 생성"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-2">
                <Text
                  variant="caption"
                  color="muted"
                  as="p"
                  className="leading-relaxed"
                >
                  1) 아래 버튼으로 프롬프트를 복사한 뒤 외부 Claude.ai 에 붙여넣고,
                  <br />
                  2) 받은 응답을 다시 아래 영역에 붙여넣고 [적용] 을 누르세요.
                </Text>
                <ClipPromptButton
                  buildPrompt={() => buildClaudePrompt(promptInput, templateId)}
                  label="프롬프트 복사"
                />
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <textarea
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    if (pasteError) setPasteError(null);
                  }}
                  placeholder="Claude 응답을 붙여넣으세요"
                  className="min-h-[8rem] w-full flex-1 resize-none rounded-md px-2.5 py-2 text-sm transition"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: `1px solid ${pasteError ? "var(--down)" : "var(--line)"}`,
                    color: "var(--ink)",
                  }}
                />
                {pasteError ? (
                  <Text
                    variant="caption"
                    as="span"
                    className="text-2xs"
                    style={{ color: "var(--down-ink)" }}
                  >
                    {pasteError}
                  </Text>
                ) : null}
              </div>
            </div>

            <div
              className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: "1px solid var(--line-2)" }}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={onClose}
                className="px-2.5 py-1"
              >
                닫기
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={applyPaste}
                disabled={raw.trim().length === 0}
                leftIcon={<Check className="h-3.5 w-3.5" />}
                className="px-3 py-1 disabled:opacity-50"
              >
                적용
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function TemplateChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="rounded-full px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        backgroundColor: active ? "var(--surface-2)" : "transparent",
        border: `1px solid ${active ? "var(--line)" : "var(--line-2)"}`,
        color: active ? "var(--ink)" : "var(--sub)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

function TabBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="gap-1.5 rounded-none px-3 py-2"
      style={{
        color: active ? "var(--ink)" : "var(--sub)",
        borderBottom: active
          ? "2px solid var(--ink)"
          : "2px solid transparent",
        marginBottom: "-1px",
        fontWeight: active ? 600 : 400,
      }}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}
