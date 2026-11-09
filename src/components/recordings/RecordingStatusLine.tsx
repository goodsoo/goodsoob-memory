import { MoreHorizontal } from "lucide-react";
import { Alert, Button, Dropdown, useToast, type DropdownItem } from "@goodsoob/ds";
import { useRestoreMeeting } from "../../hooks/useMeetings";
import { useCorrectionsRecording, useLinkRecording } from "../../hooks/useRecordings";
import { canLink } from "../../lib/recordings/inbox";
import type { RecordingItem } from "../../lib/recordings/merge";
import {
  errorIsDiarize,
  failedChunksText,
  jobErrorText,
  processingErrorMessage,
  stepLabel,
} from "../../lib/recordings/processing";
import { Spinner } from "../common/Spinner";
import { Text } from "../common/Text";
import { formatDuration, recordingErrorMessage, recordingSubtitle, recordingWhen } from "./recordingLabels";

// ── 순수 판정 (테스트 대상) ──────────────────────────────────────────────────

export type StatusAction =
  | "split" // 말한 사람 나누기 창
  | "rerunSplit" // 나누기 오류 → 나누기 창
  | "send" // 메모로 보내기 창
  | "findFixes" // 고칠 곳 찾기 (Claude)
  | "rerunFixes" // 고칠 곳 찾기 오류 → 처음부터 다시
  | "retryFailed" // 실패한 부분만 다시
  | "nextReview" // 다음 고칠 곳
  | "openMemo"
  | "restoreMemo";

export interface StatusButton {
  action: StatusAction;
  label: string;
  variant: "primary" | "secondary" | "ghost";
  title?: string;
  disabled?: boolean;
}

export interface StatusView {
  /** text = 글자만 · processing = Spinner + 글자 · error = Alert(down) 가 상태 줄을 대신하고 버튼도 Alert 안. */
  kind: "text" | "processing" | "error";
  text: string | null;
  primary?: StatusButton;
  secondary?: StatusButton;
  /** 고칠 곳 찾기 계열 오류 — Alert 아래 "본문이 Claude 로 전송됩니다." */
  claudeNote?: boolean;
  /** 연결이 끊긴 음성 기록이 있는 메모 path (보낼 수 있는 상태에서만). */
  orphanPath?: string | null;
}

export const CLAUDE_NOTE = "본문이 Claude 로 전송됩니다.";

function memoTitle(t: string | undefined): string {
  return t?.trim() || "제목 없음";
}

/**
 * A 표의 상태별 상태 줄 + 머리 버튼. remaining = 위치를 찾은(밑줄 친) 고칠 곳 수, null = 아직 불러오는 중.
 * unmatched = 위치를 못 찾은 고칠 곳 수 (상태 줄 개수에는 넣지 않는다).
 */
export function statusView(
  item: RecordingItem,
  { remaining, unmatched = 0 }: { remaining: number | null; unmatched?: number },
): StatusView {
  const { entry, status } = item;
  const { destination, pipeline } = status;
  const job = entry.job;

  if (destination === "linked" || destination === "moveIncomplete") {
    const memo = item.memos[0];
    const text =
      `'${memoTitle(memo?.title)}' 메모로 보냈습니다. 고칠 곳은 메모의 음성 기록에서 고칩니다.` +
      (destination === "moveIncomplete" ? " 메모로 옮기는 중입니다." : "");
    return {
      kind: "text",
      text,
      primary: memo ? { action: "openMemo", label: "메모 열기", variant: "primary" } : undefined,
    };
  }
  if (destination === "trash") {
    const memo = item.trashedMemos[0];
    return {
      kind: "text",
      text: `이 녹음을 보낸 메모 '${memoTitle(memo?.title)}' 가 휴지통에 있습니다. 메모를 복원하면 음성 기록도 함께 돌아옵니다.`,
      secondary: { action: "restoreMemo", label: "메모 복원", variant: "secondary", disabled: !memo },
    };
  }
  if (destination === "transcriptMissing") {
    return {
      kind: "text",
      text: "보냈던 메모가 휴지통에서 비워져 음성 기록도 함께 지워졌습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.",
    };
  }

  const send: StatusButton = { action: "send", label: "메모로 보내기", variant: "primary" };

  switch (pipeline) {
    case "waiting":
      return { kind: "text", text: "자동 받아쓰기를 기다리는 중입니다." };
    case "raw":
      return {
        kind: "text",
        text: "자동 받아쓰기 상태입니다. 말한 사람을 나누면 문단별로 듣고 고칠 수 있습니다.",
        primary: { action: "split", label: "말한 사람 나누기", variant: "primary" },
      };
    case "processing":
      return { kind: "processing", text: `${stepLabel(job?.step)}. 다른 녹음으로 넘어가도 계속 진행됩니다.` };
    case "error": {
      const chunks = failedChunksText(job?.failedChunks);
      const text = chunks ? `${jobErrorText(job)} ${chunks}` : jobErrorText(job);
      if (errorIsDiarize(job, entry.stt.diarized)) {
        return {
          kind: "error",
          text,
          primary: entry.stt.done ? { action: "rerunSplit", label: "다시 실행", variant: "primary" } : undefined,
        };
      }
      const canRetryFailed = !!job?.failedChunks && job.failedChunks.length > 0;
      return canRetryFailed
        ? {
            kind: "error",
            text,
            claudeNote: true,
            primary: { action: "retryFailed", label: "실패한 부분만 다시 실행", variant: "primary" },
            secondary: { action: "rerunFixes", label: "다시 실행", variant: "secondary" },
          }
        : {
            kind: "error",
            text,
            claudeNote: true,
            primary: { action: "rerunFixes", label: "다시 실행", variant: "primary" },
          };
    }
    case "correction":
      return {
        kind: "text",
        text: "문단을 눌러 고치고, 시각을 눌러 그 부분부터 듣습니다.",
        primary: send,
        secondary: { action: "findFixes", label: "고칠 곳 찾기", variant: "ghost", title: CLAUDE_NOTE },
      };
    case "review": {
      let text: string;
      if (remaining === null) text = "고칠 곳을 불러오는 중입니다.";
      else if (remaining > 0) text = `고칠 곳 ${remaining}개 남음. 밑줄을 눌러 바꾸거나 그대로 둡니다.`;
      else if (unmatched > 0) text = "남은 고칠 곳은 본문에서 위치를 못 찾았습니다. 맨 아래 목록에서 확인합니다.";
      else text = "고칠 곳을 모두 확인했습니다. 보낼 메모를 고릅니다.";
      return {
        kind: "text",
        text,
        primary: send,
        secondary: {
          action: "nextReview",
          label: "다음 고칠 곳",
          variant: "secondary",
          disabled: !remaining || remaining <= 0,
        },
      };
    }
    case "corrected":
    case "textOnly":
      if (!canLink(item)) {
        return {
          kind: "text",
          text: "녹음 파일 없이 자동 받아쓰기만 남아 고치거나 보낼 수 없습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.",
        };
      }
      return {
        kind: "text",
        text: "고치기를 마쳤습니다. 보낼 메모를 고릅니다.",
        primary: send,
        orphanPath: typeof entry.orphan === "string" ? entry.orphan : null,
      };
  }
}

// ── 머리 (제목 · 메타 · 버튼 · ⋯ · 상태 줄) ─────────────────────────────────

export interface RecordingMenu {
  /** 있으면 "말한 사람 다시 나누기" (canRediarize 일 때만 넘긴다). */
  onRediarize?: () => void;
  /** "고칠 곳 다시 찾기" — correction·review 일 때만. */
  refind: boolean;
  onDelete: () => void;
  deleteDisabled: boolean;
}

type Props = {
  item: RecordingItem;
  view: StatusView;
  menu: RecordingMenu;
  /** 창을 여는 동작 (split·rerunSplit·send·nextReview·openMemo) — 나머지는 여기서 처리. */
  onAction: (action: StatusAction) => void;
};

export function RecordingStatusLine({ item, view, menu, onAction }: Props) {
  const { entry } = item;
  const toast = useToast();
  const corrections = useCorrectionsRecording();
  const restore = useRestoreMeeting();
  const link = useLinkRecording();

  const subtitle = recordingSubtitle(entry);
  const when = recordingWhen(entry);
  const duration = formatDuration(entry.durationSec);
  const title = subtitle ?? when;
  const meta = [subtitle ? when : null, duration || null].filter(Boolean).join(" · ");

  function runCorrections(retryFailed: boolean) {
    corrections.mutate(
      { base: entry.base, retryFailed },
      {
        onSuccess: () => toast.show("고칠 곳 찾기를 시작했습니다.", { variant: "ok" }),
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  function handle(action: StatusAction) {
    switch (action) {
      case "findFixes":
      case "rerunFixes":
        return runCorrections(false);
      case "retryFailed":
        return runCorrections(true);
      case "restoreMemo": {
        const memo = item.trashedMemos[0];
        if (!memo) return;
        return restore.mutate(memo.id, {
          onSuccess: () => toast.show("메모를 복원했습니다.", { variant: "ok" }),
          onError: () => toast.show("메모 복원에 실패했습니다. 휴지통에서 다시 시도하세요.", { variant: "down" }),
        });
      }
      default:
        return onAction(action);
    }
  }

  function busyOf(action: StatusAction): boolean {
    if (action === "findFixes" || action === "rerunFixes" || action === "retryFailed") return corrections.isPending;
    if (action === "restoreMemo") return restore.isPending;
    return false;
  }

  function renderButton(b: StatusButton | undefined) {
    if (!b) return null;
    return (
      <Button
        key={b.action}
        size="sm"
        variant={b.variant}
        title={b.title}
        disabled={b.disabled || busyOf(b.action)}
        onClick={() => handle(b.action)}
      >
        {b.label}
      </Button>
    );
  }

  const menuItems: DropdownItem[] = [];
  if (menu.onRediarize) {
    menuItems.push({ key: "rediarize", label: "말한 사람 다시 나누기", onSelect: menu.onRediarize });
  }
  if (menu.refind) {
    menuItems.push({
      key: "refind",
      label: "고칠 곳 다시 찾기",
      disabled: corrections.isPending,
      onSelect: () => runCorrections(false),
    });
  }
  menuItems.push({
    key: "delete",
    label: "삭제",
    tone: "danger",
    disabled: menu.deleteDisabled,
    onSelect: menu.onDelete,
  });

  const isError = view.kind === "error";
  const orphanPath = view.orphanPath ?? null;

  return (
    <header className="flex flex-col gap-3 pt-6 pb-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Text variant="h3" as="h3">
            {title}
          </Text>
          <Text variant="caption" color="muted" as="div" className="break-all pt-0.5">
            {meta ? <span className="tabular-nums">{meta} · </span> : null}
            <span className="font-mono">{entry.base}</span>
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isError ? null : (
            <>
              {renderButton(view.primary)}
              {renderButton(view.secondary)}
            </>
          )}
          <Dropdown
            trigger={
              <Button variant="ghost" iconOnly title="녹음 메뉴" aria-label="녹음 메뉴">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
            items={menuItems}
          />
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col gap-2">
          <Alert
            variant="down"
            action={
              view.primary || view.secondary ? (
                <div className="flex flex-wrap items-center gap-2">
                  {renderButton(view.primary)}
                  {renderButton(view.secondary)}
                </div>
              ) : undefined
            }
          >
            {view.text}
          </Alert>
          {view.claudeNote ? (
            <Text variant="caption" color="muted" as="div">
              {CLAUDE_NOTE}
            </Text>
          ) : null}
        </div>
      ) : view.text ? (
        <div className="flex items-center gap-2" data-testid="recording-status">
          {view.kind === "processing" ? <Spinner size="xs" /> : null}
          <Text variant="caption" color="secondary" as="div">
            {view.text}
          </Text>
        </div>
      ) : null}

      {orphanPath ? (
        <Alert
          variant="info"
          title="연결이 끊긴 음성 기록이 있습니다"
          action={
            <Button
              size="sm"
              disabled={link.isPending}
              onClick={() =>
                link
                  .link({ base: entry.base, memoPath: orphanPath })
                  .then(() => toast.show("연결을 복구했습니다.", { variant: "ok" }))
                  .catch((err) => toast.show(recordingErrorMessage(err), { variant: "down" }))
              }
            >
              연결 복구
            </Button>
          }
        >
          <span className="break-all">{orphanPath}</span> 의 음성 기록에 이 녹음 섹션이 있습니다.
        </Alert>
      ) : null}
    </header>
  );
}
