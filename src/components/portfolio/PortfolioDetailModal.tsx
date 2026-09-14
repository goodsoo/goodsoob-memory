import { useEffect, useState } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
  EyeOff,
  Eye,
  GitBranch,
  Sparkles,
  Check,
  Pencil,
} from "lucide-react";
import {
  folderPathOfCard,
  isGithubCard,
  type PortfolioCategory,
  type PortfolioWorkMeta,
} from "../../api/portfolio";
import {
  useDeletePortfolioWork,
  usePortfolioCategories,
  usePortfolioWork,
  useUpdatePortfolioFrontmatter,
} from "../../hooks/usePortfolio";
import { useVault } from "../../lib/vault/useVault";
import { vaultAssetSrc } from "../../lib/portfolio/assetUrl";
import {
  categoryColor as lookupCategoryColor,
  categoryLabel as lookupCategoryLabel,
} from "../../lib/portfolio/categoryLookup";
import { relativeDateLabel } from "../../lib/dates";
import { buildPRPrompt, parsePRResponse } from "../../lib/clipboardPrompt";
import { runClaude } from "../../lib/portfolio/claude";
import { ManualPasteFallback } from "./ManualPasteFallback";
import { ScreenshotDropzone } from "./ScreenshotDropzone";
import { CategoryCombobox } from "./CategoryCombobox";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Chip } from "../common/Chip";
import { Spinner } from "../common/Spinner";

type Props = {
  work: PortfolioWorkMeta;
  onClose: () => void;
};

// 카드 클릭 시 열리는 detail / 편집 모달.
// 좌측: 큰 스크린샷 viewer + thumb strip + dropzone
// 우측: impact / 카테고리 / 위치 (read only) / paste area / 메타 / included·삭제
export function PortfolioDetailModal({ work, onClose }: Props) {
  const fm = work.frontmatter;
  const updateFm = useUpdatePortfolioFrontmatter(work.prSlug);
  const deleteWork = useDeletePortfolioWork();
  const { adapter } = useVault();
  const vaultRoot = adapter.getRoot();

  const [activeShot, setActiveShot] = useState(0);
  const [editing, setEditing] = useState(false);
  // edit mode draft — 수정 완료 누르면 mutate, 취소/닫기면 버림.
  const [impactDraft, setImpactDraft] = useState(fm.impact_summary);
  const [categoryDraft, setCategoryDraft] = useState<PortfolioCategory>(
    fm.category,
  );
  const [promptCopied, setPromptCopied] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<
    { impact: string; category: PortfolioCategory } | null
  >(null);
  const fullWork = usePortfolioWork(work.prSlug);
  const categories = usePortfolioCategories();

  const resetDraft = () => {
    setImpactDraft(fm.impact_summary);
    setCategoryDraft(fm.category);
    setSuggestion(null);
    setRequestError(null);
  };

  const handleEnterEdit = () => {
    resetDraft();
    setEditing(true);
  };
  const handleCancelEdit = () => {
    resetDraft();
    setEditing(false);
  };
  const handleSaveEdit = () => {
    const trimmedImpact = impactDraft.trim();
    updateFm.mutate({
      impact_summary: trimmedImpact,
      category: categoryDraft,
    });
    setEditing(false);
    setSuggestion(null);
  };

  // 모달 닫기 — edit mode 중이면 변경 자동 취소 + 닫기.
  const handleClose = () => {
    if (editing) resetDraft();
    setEditing(false);
    onClose();
  };

  const screenshotSrc = (path: string) => vaultAssetSrc(vaultRoot, path);
  const categoryLabel = lookupCategoryLabel(fm.category);
  const categoryColor = lookupCategoryColor(fm.category);
  // 카드 위치 라벨 — github 카드는 repo, 수동 카드는 vault folder path. 편집 X.
  const sourceDescription = isGithubCard(fm)
    ? `${fm.github_owner}/${fm.github_repo}`
    : folderPathOfCard(work.filePath);
  const relTime = fm.github_merged_at
    ? relativeDateLabel(fm.github_merged_at.slice(0, 10))
    : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) {
          handleCancelEdit();
        } else {
          handleClose();
        }
        return;
      }
      if (fm.screenshots.length === 0) return;
      if (e.key === "ArrowLeft") {
        setActiveShot((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setActiveShot((i) => Math.min(fm.screenshots.length - 1, i + 1));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, fm.screenshots.length]);

  const handleDelete = () => {
    const ok = window.confirm(
      `"${fm.github_title}" 카드를 휴지통으로 보냅니다. 진행할까요?`,
    );
    if (!ok) return;
    deleteWork.mutate(work.prSlug);
    onClose();
  };

  const handleIncludedToggle = () => {
    if (fm.included) {
      const ok = window.confirm(
        `"${fm.github_title}" 을(를) 평가 자료에서 제외합니다. 카드 목록 "미사용" 필터에서 다시 켤 수 있어요.`,
      );
      if (!ok) return;
    }
    updateFm.mutate({ included: !fm.included });
  };

  const buildPrompt = (): string => {
    const description = fullWork.data?.description ?? "";
    return buildPRPrompt({
      title: fm.github_title,
      body: description,
      url: fm.github_pr_url,
      changedFiles: fm.github_changed_files,
      additions: fm.github_additions,
      deletions: fm.github_deletions,
      categories,
    });
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPrompt());
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      // 무시
    }
  };

  const handleClaudeRequest = async () => {
    if (fullWork.isLoading) return;
    setRequesting(true);
    setRequestError(null);
    setSuggestion(null);
    try {
      const prompt = buildPrompt();
      const result = await runClaude(prompt);
      if (result.code !== 0) {
        const msg = result.stderr.trim();
        // claude 미설치 / 미인증 / 기타 — 가장 가능성 높은 두 가지를 anchor.
        if (/not found|command not found/i.test(msg)) {
          throw new Error(
            "claude CLI 가 안 보여요. 설치 후 `claude` 로그인을 먼저.",
          );
        }
        if (/auth|login|unauthor/i.test(msg)) {
          throw new Error(
            "claude 로그인이 필요해요. 터미널에서 `claude` 실행 후 인증해주세요.",
          );
        }
        throw new Error(msg || "claude CLI 실행 실패");
      }
      const parsed = parsePRResponse(result.stdout);
      if (!parsed) {
        throw new Error(
          "응답 형식을 못 알아봤어요. 아래 paste 영역으로 직접 진행해주세요.",
        );
      }
      // 자동 저장 X — preview 박스에 제안만 노출. 사용자가 [적용] 누르면 mutate.
      setSuggestion({ impact: parsed.impact, category: parsed.category });
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  };

  // edit mode 안에서 호출됨. draft 에만 반영 — [수정 완료] 누를 때 실제 mutate.
  const applySuggestion = () => {
    if (!suggestion) return;
    setImpactDraft(suggestion.impact);
    setCategoryDraft(suggestion.category);
    setSuggestion(null);
  };

  const currentShot = fm.screenshots[activeShot];

  return (
    <Modal
      open
      onClose={handleClose}
      size="xl"
      dismissOnEscape={false}
      ariaLabel={fm.github_title}
    >
        {/* 헤더 */}
        <div
          className="flex items-center gap-3 border-b px-5 py-3"
          style={{ borderColor: "var(--line-2)" }}
        >
          <Text
            variant="caption"
            color="secondary"
            as="span"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5"
            style={{ backgroundColor: "var(--surface-2)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: categoryColor }}
            />
            {categoryLabel}
          </Text>
          <Text variant="caption" color="muted" as="span">
            {fm.github_owner}/{fm.github_repo}
            {fm.github_pr_number > 0 ? ` · PR #${fm.github_pr_number}` : ""}
            {relTime ? ` · ${relTime}` : ""}
          </Text>
          <div className="ml-auto flex items-center gap-1">
            {editing ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveEdit}
                  leftIcon={<Check className="h-3.5 w-3.5" />}
                  title="변경 저장"
                >
                  수정 완료
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCancelEdit}
                  style={{
                    backgroundColor: "var(--surface-2)",
                    color: "var(--ink)",
                  }}
                  title="변경 버리기 (ESC)"
                >
                  취소
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEnterEdit}
                leftIcon={<Pencil className="h-3.5 w-3.5" />}
                style={{
                  backgroundColor: "var(--surface-2)",
                  color: "var(--ink)",
                }}
                title="편집 모드 진입"
              >
                편집
              </Button>
            )}
            <Button
              variant="icon"
              onClick={handleClose}
              title="닫기 (ESC)"
              style={{ color: "var(--sub)" }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 본문 — 좌 viewer / 우 편집. grid row 강제 1fr (컨텐츠가 85vh 넘어도 cell 이 grid 영역만 차지하도록). */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[1.2fr_1fr]">
          {/* 좌측: 스크린샷 viewer — scroll content + sticky dropzone footer */}
          <div
            className="flex min-h-0 flex-col overflow-hidden border-b md:border-b-0 md:border-r"
            style={{ borderColor: "var(--line-2)" }}
          >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div
              className="relative flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-lg"
              style={{ backgroundColor: "var(--surface-2)" }}
            >
              {currentShot ? (
                <>
                  <img
                    src={screenshotSrc(currentShot.path)}
                    alt={currentShot.caption || fm.github_title}
                    className="max-h-full max-w-full object-contain"
                  />
                  {fm.screenshots.length > 1 ? (
                    <>
                      {activeShot > 0 ? (
                        <Button
                          variant="icon"
                          onClick={() => setActiveShot((i) => i - 1)}
                          className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full"
                          style={{
                            backgroundColor: "var(--bg-overlay)",
                            color: "var(--ink)",
                          }}
                          title="이전 (←)"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {activeShot < fm.screenshots.length - 1 ? (
                        <Button
                          variant="icon"
                          onClick={() => setActiveShot((i) => i + 1)}
                          className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full"
                          style={{
                            backgroundColor: "var(--bg-overlay)",
                            color: "var(--ink)",
                          }}
                          title="다음 (→)"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Text
                        variant="caption"
                        color="secondary"
                        as="div"
                        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md px-2 py-0.5 text-[11px]"
                        style={{ backgroundColor: "var(--bg-overlay)" }}
                      >
                        {activeShot + 1} / {fm.screenshots.length}
                        {currentShot.label ? ` · ${currentShot.label}` : ""}
                      </Text>
                    </>
                  ) : currentShot.label ? (
                    <Text
                      variant="caption"
                      color="secondary"
                      as="div"
                      className="absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-[11px]"
                      style={{ backgroundColor: "var(--bg-overlay)" }}
                    >
                      {currentShot.label}
                    </Text>
                  ) : null}
                </>
              ) : (
                <div
                  className="flex flex-col items-center gap-2"
                  style={{ color: "var(--faint)" }}
                >
                  <GitBranch className="h-6 w-6" strokeWidth={1.5} />
                  <Text variant="caption" as="span">
                    스크린샷 없음 — 아래에서 드롭/클릭
                  </Text>
                </div>
              )}
            </div>

            {/* thumbnail strip */}
            {fm.screenshots.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto">
                {fm.screenshots.map((s, i) => (
                  <Button
                    key={s.path + i}
                    variant="ghost"
                    onClick={() => setActiveShot(i)}
                    className="relative h-12 w-16 shrink-0 overflow-hidden p-0"
                    style={{
                      border:
                        i === activeShot
                          ? "2px solid var(--ink)"
                          : "1px solid var(--line)",
                    }}
                    title={s.caption || s.path}
                  >
                    <img
                      src={screenshotSrc(s.path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </Button>
                ))}
              </div>
            ) : null}

          </div>
            {/* dropzone — read mode 에서도 노출. 수동 카드는 빈 채로 시작해 스크린샷
                추가 진입이 항상 필요 + 옛 PR 카드도 PR body 자동 import 누락 시 동일 자리.
                업로드는 즉시 vault 적용 (편집 모드 / 취소와 무관). */}
            <div
              className="flex shrink-0 gap-2 border-t px-4 py-3"
              style={{ borderColor: "var(--line-2)" }}
            >
              <div className="flex-1">
                <ScreenshotDropzone
                  prSlug={work.prSlug}
                  existing={fm.screenshots}
                  label="before"
                />
              </div>
              <div className="flex-1">
                <ScreenshotDropzone
                  prSlug={work.prSlug}
                  existing={fm.screenshots}
                  label="after"
                />
              </div>
            </div>
          </div>

          {/* 우측: 편집 패널 — scroll content + sticky footer */}
          <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <Field label="한 줄 임팩트">
              {editing ? (
                <input
                  value={impactDraft}
                  onChange={(e) => setImpactDraft(e.target.value)}
                  placeholder="60자 이내 한 문장"
                  maxLength={60}
                  className="w-full rounded-md px-2 py-1.5 text-sm font-semibold"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                  }}
                />
              ) : (
                <Text
                  variant="body"
                  weight="semibold"
                  as="div"
                  className="break-words"
                  style={{
                    color: fm.impact_summary
                      ? "var(--ink)"
                      : "var(--faint)",
                    fontStyle: fm.impact_summary ? "normal" : "italic",
                  }}
                >
                  {fm.impact_summary || "한 줄 임팩트 추가 필요"}
                </Text>
              )}
            </Field>

            <Field label="PR 제목">
              <div className="flex items-start gap-2">
                <Text
                  variant="body"
                  as="div"
                  className="min-w-0 flex-1 break-words"
                >
                  {fm.github_title}
                </Text>
                {fm.github_pr_url ? (
                  <a
                    href={fm.github_pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition hover:underline"
                    style={{ color: "var(--sub)" }}
                    title={fm.github_pr_url}
                  >
                    <ExternalLink className="h-3 w-3" />
                    깃헙에서 열기
                  </a>
                ) : null}
              </div>
            </Field>

            <Field label="카테고리">
              {editing ? (
                <CategoryCombobox
                  value={categoryDraft}
                  onChange={(next) => setCategoryDraft(next)}
                />
              ) : (
                <Text
                  variant="body"
                  as="div"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ backgroundColor: "var(--surface-2)" }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: categoryColor }}
                  />
                  {categoryLabel}
                </Text>
              )}
            </Field>

            <Field label="위치">
              <Text
                variant="body"
                as="div"
                color={sourceDescription ? "primary" : "muted"}
              >
                {sourceDescription || "(폴더 없음 — root)"}
              </Text>
            </Field>

            {editing ? (
            <Field label="Claude 로 자동 채움">
              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  onClick={handleClaudeRequest}
                  disabled={requesting || fullWork.isLoading}
                  leftIcon={
                    requesting || fullWork.isLoading ? (
                      <Spinner size="md" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )
                  }
                  className="px-3 py-2 disabled:opacity-60"
                >
                  {requesting
                    ? "Claude 에게 묻는 중…"
                    : fullWork.isLoading
                      ? "PR 본문 로딩…"
                      : "Claude 한테 요청"}
                </Button>
                <Text
                  variant="caption"
                  color="muted"
                  as="span"
                  className="text-[11px]"
                >
                  구독 사용량으로 호출. 본인 머신의 <code>claude</code> CLI 가 필요.
                </Text>
                {requestError ? (
                  <Text
                    variant="caption"
                    as="div"
                    className="rounded-md px-2.5 py-1.5 text-[11px]"
                    style={{
                      backgroundColor: "var(--down-soft)",
                      color: "var(--down-ink)",
                    }}
                  >
                    {requestError}
                  </Text>
                ) : null}

                {suggestion ? (
                  <div
                    className="flex flex-col gap-2 rounded-md p-3"
                    style={{
                      backgroundColor: "var(--surface-2)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <Text
                      variant="caption"
                      color="muted"
                      as="span"
                      className="text-[10px] uppercase tracking-wider"
                    >
                      Claude 제안
                    </Text>
                    <Text
                      variant="body"
                      weight="semibold"
                      as="div"
                      className="leading-snug"
                    >
                      {suggestion.impact}
                    </Text>
                    <div className="flex items-center gap-2">
                      <Chip
                        dot={lookupCategoryColor(suggestion.category)}
                        style={{ backgroundColor: "var(--surface)" }}
                      >
                        {lookupCategoryLabel(suggestion.category)}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={applySuggestion}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                        className="px-2.5 py-1"
                      >
                        적용
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClaudeRequest}
                        disabled={requesting}
                        leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                        className="px-2.5 py-1 disabled:opacity-50"
                      >
                        다시 요청
                      </Button>
                      <Button
                        variant="icon"
                        onClick={() => setSuggestion(null)}
                        className="ml-auto"
                        style={{ color: "var(--faint)" }}
                        title="제안 닫기"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : null}

                <ManualPasteFallback
                  requestError={requestError}
                  promptCopied={promptCopied}
                  copyDisabled={fullWork.isLoading}
                  onCopyPrompt={handleCopyPrompt}
                  onParsed={(impact, category) => {
                    setImpactDraft(impact);
                    setCategoryDraft(category as PortfolioCategory);
                  }}
                />
              </div>
            </Field>
            ) : null}

            <Text
              variant="caption"
              color="muted"
              as="div"
              className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-3 text-[11px]"
              style={{ borderColor: "var(--line-2)" }}
            >
              <span>변경:</span>
              <span>
                +{fm.github_additions} −{fm.github_deletions} ·{" "}
                {fm.github_changed_files} files
              </span>
              {fm.github_merged_at ? (
                <>
                  <span>병합:</span>
                  <span>{fm.github_merged_at.slice(0, 10)}</span>
                </>
              ) : null}
            </Text>

          </div>
          {/* footer — scroll 밖, 항상 보임. solid 스타일 (Claude 요청 버튼 계열과 통일). */}
          <div
            className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3"
            style={{ borderColor: "var(--line-2)" }}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={handleIncludedToggle}
              leftIcon={
                fm.included ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--ink)",
              }}
              title={fm.included ? "평가 자료에서 제외" : "평가 자료에 포함"}
            >
              {fm.included ? "미사용" : "포함"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              style={{
                backgroundColor: "var(--down-soft)",
                color: "var(--down-ink)",
                border: "1px solid var(--down)",
              }}
              title="휴지통으로 보내기"
            >
              삭제
            </Button>
          </div>
          </div>
        </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Text
        variant="caption"
        color="muted"
        as="span"
        className="text-[11px] uppercase tracking-wider"
      >
        {label}
      </Text>
      {children}
    </div>
  );
}
