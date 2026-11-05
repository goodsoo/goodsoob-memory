import { useMemo, useState, type ReactNode } from "react";
import { Alert, Card, Field, Input, ListGroup, ListRow, useToast } from "@goodsoob/ds";
import type { ReviewItem } from "../../api/recordings";
import { useMeetings, useRestoreMeeting } from "../../hooks/useMeetings";
import {
  useCorrectionsRecording,
  useDiarizeRecording,
  useLinkRecording,
  type LinkVars,
} from "../../hooks/useRecordings";
import { formatDisplayDate } from "../../lib/dates";
import { canLink } from "../../lib/recordings/inbox";
import { rankLinkCandidates, type MemoRef, type RecordingItem } from "../../lib/recordings/merge";
import {
  MAX_NAME_LEN,
  MAX_SPEAKERS,
  MIN_SPEAKERS,
  buildNames,
  diarizeEstimate,
  errorIsDiarize,
  failedChunksText,
  jobErrorText,
  processingErrorMessage,
  stepLabel,
  validateSpeakers,
} from "../../lib/recordings/processing";
import { ConfirmDialog } from "../ConfirmDialog";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { recordingErrorMessage } from "./recordingLabels";

export const LINK_CONFIRM_TITLE = "이 메모에 연결합니다.";
export const LINK_CONFIRM_MESSAGE =
  "연결하면 전사본이 메모의 음성 기록으로 옮겨지고, 녹음 화면에서는 더 이상 전사를 고칠 수 없습니다.";

const CANDIDATE_LIMIT = 3;
const SEARCH_LIMIT = 20;

type Props = {
  item: RecordingItem;
  onOpenMeeting: (uid: string) => void;
  /** 연결 성공 — 다음 녹음으로. */
  onLinked: () => void;
  /** 리뷰 중: 결정 안 된 후보 수 · 위치 못 찾은 후보. */
  remaining: number;
  unmatched: readonly ReviewItem[];
  onNextHighlight: () => void;
  onKeepUnmatched: (id: number) => void;
  /** 교정 완료 (작업 파일 저장 → complete). */
  onComplete: () => void;
  completing: boolean;
  /** ⋯ 메뉴 "화자 다시 나누기" 로 연 상태. */
  rediarize: boolean;
  onRediarizeClose: () => void;
};

/** 다음 할 일 카드 — 파이프라인 상태별 하나 (docs/designs/recording-redesign.md 표). */
export function NextStepCard(props: Props) {
  const { item, rediarize } = props;
  const { entry, status } = item;
  const { destination, pipeline } = status;
  const job = entry.job;

  if (destination === "linked" || destination === "moveIncomplete") {
    const memo = item.memos[0];
    return (
      <StepCard title="메모에 연결됨">
        <Text variant="body" color="secondary">
          {memo?.title?.trim() || "(제목 없음)"}
          {destination === "moveIncomplete" ? " · 전사본 이사를 마무리하는 중입니다." : ""}
        </Text>
        <Actions>
          {memo ? (
            <Button size="sm" variant="primary" onClick={() => props.onOpenMeeting(memo.uid)}>
              메모 열기
            </Button>
          ) : null}
        </Actions>
      </StepCard>
    );
  }
  if (destination === "trash") return <TrashedCard item={item} />;
  if (destination === "transcriptMissing") {
    return (
      <StepCard title="전사본 없음">
        <Text variant="body" color="secondary">
          연결됐던 메모가 휴지통에서 비워져 전사본도 함께 지워졌습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.
        </Text>
      </StepCard>
    );
  }

  if (rediarize && entry.hasM4a && pipeline !== "processing") {
    return (
      <StepCard title="화자 다시 나누기">
        <Text variant="caption" color="muted" as="div">
          다시 나누면 지금까지 고친 내용과 고칠 곳 후보가 사라집니다.
        </Text>
        <DiarizeForm item={item} actionLabel="화자분리" onStarted={props.onRediarizeClose} onCancel={props.onRediarizeClose} />
      </StepCard>
    );
  }

  switch (pipeline) {
    case "waiting":
      return (
        <StepCard title="전사 대기">
          <Text variant="body" color="secondary">
            자동 전사를 기다리는 중입니다.
          </Text>
        </StepCard>
      );
    case "raw":
      return (
        <StepCard title="화자 나누기">
          <DiarizeForm item={item} actionLabel="화자분리" />
        </StepCard>
      );
    case "processing":
      return (
        <StepCard title={stepLabel(job?.step)}>
          <Text variant="body" color="secondary">
            다른 녹음으로 넘어가도 계속 진행됩니다.
          </Text>
        </StepCard>
      );
    case "error":
      return (
        <StepCard title="처리에 실패했습니다">
          <Alert variant="down">
            {jobErrorText(job)}
            {failedChunksText(job?.failedChunks) ? ` ${failedChunksText(job?.failedChunks)}` : ""}
          </Alert>
          {errorIsDiarize(job, entry.stt.diarized) ? (
            entry.stt.done ? (
              <DiarizeForm item={item} actionLabel="다시 실행" />
            ) : null
          ) : (
            <CorrectionsAction base={entry.base} rerun failedChunks={job?.failedChunks} />
          )}
        </StepCard>
      );
    case "correction":
      return (
        <StepCard title="듣고 고치기">
          <Text variant="body" color="secondary">
            발화를 눌러 고치고, 시각을 눌러 그 지점을 들을 수 있습니다. 다 고쳤으면 교정 완료를 누르세요.
          </Text>
          <Actions>
            <Button size="sm" variant="primary" disabled={props.completing} onClick={props.onComplete}>
              교정 완료
            </Button>
            <CorrectionsAction base={entry.base} inline />
          </Actions>
          <Text variant="caption" color="muted" as="div">
            Claude 로 고칠 곳 찾기를 누르면 전사 내용이 Claude 로 전송됩니다.
          </Text>
        </StepCard>
      );
    case "review":
      return (
        <StepCard title={props.remaining > 0 ? `고칠 곳 ${props.remaining}개 남음` : "고칠 곳을 불러오는 중입니다"}>
          <Text variant="body" color="secondary">
            표시된 구절을 눌러 수락하거나 원문을 유지하세요. 교정 완료를 누르면 남은 후보는 원문을 유지합니다.
          </Text>
          <Actions>
            <Button
              size="sm"
              variant="primary"
              disabled={props.remaining - props.unmatched.length <= 0}
              onClick={props.onNextHighlight}
            >
              다음 고칠 곳
            </Button>
            <Button size="sm" disabled={props.completing} onClick={props.onComplete}>
              교정 완료
            </Button>
          </Actions>
          {props.unmatched.length > 0 ? (
            <UnmatchedList items={props.unmatched} onKeep={props.onKeepUnmatched} />
          ) : null}
        </StepCard>
      );
    case "corrected":
    case "textOnly":
      if (!canLink(item)) {
        return (
          <StepCard title="텍스트만">
            <Text variant="body" color="secondary">
              녹음 파일 없이 초벌 전사만 남아 있어 고치거나 연결할 수 없습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.
            </Text>
          </StepCard>
        );
      }
      return <LinkCard item={item} onLinked={props.onLinked} />;
  }
}

// ── 조각 ─────────────────────────────────────────────────────────────────────

function StepCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card data-testid="next-step-card">
      <div className="space-y-3">
        <Text variant="h4" as="h3">
          {title}
        </Text>
        {children}
      </div>
    </Card>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function UnmatchedList({ items, onKeep }: { items: readonly ReviewItem[]; onKeep: (id: number) => void }) {
  return (
    <div className="space-y-2">
      <Text variant="caption" color="muted" weight="semibold" as="div">
        위치를 찾지 못한 후보 {items.length}개
      </Text>
      <ListGroup>
        {items.map((it) => (
          <ListRow
            key={it.id}
            label={
              <span className="min-w-0">
                <span style={{ color: "var(--sub)" }}>{it.orig || "(원문 없음)"}</span>
                {it.sugg ? <span> → {it.sugg}</span> : null}
              </span>
            }
            value="원문 유지"
            title="이 후보를 넘기고 원문을 유지합니다"
            onClick={() => onKeep(it.id)}
          />
        ))}
      </ListGroup>
    </div>
  );
}

function TrashedCard({ item }: { item: RecordingItem }) {
  const toast = useToast();
  const restore = useRestoreMeeting();
  const memo = item.trashedMemos[0];
  return (
    <StepCard title="휴지통 메모에 연결됨">
      <Text variant="body" color="secondary">
        이 녹음이 연결된 메모 &apos;{memo?.title?.trim() || "제목 없음"}&apos; 가 휴지통에 있습니다. 메모를 복원하면
        전사본도 함께 돌아옵니다.
      </Text>
      <Actions>
        <Button
          size="sm"
          disabled={restore.isPending || !memo}
          onClick={() =>
            restore.mutate(memo.id, {
              onSuccess: () => toast.show("메모를 복원했습니다.", { variant: "ok" }),
              onError: () => toast.show("메모 복원에 실패했습니다. 휴지통에서 다시 시도하세요.", { variant: "down" }),
            })
          }
        >
          메모 복원
        </Button>
      </Actions>
    </StepCard>
  );
}

// ── 화자분리 ─────────────────────────────────────────────────────────────────

function DiarizeForm({
  item,
  actionLabel,
  onStarted,
  onCancel,
}: {
  item: RecordingItem;
  actionLabel: string;
  onStarted?: () => void;
  onCancel?: () => void;
}) {
  const { entry } = item;
  const toast = useToast();
  const diarize = useDiarizeRecording();
  const [speakersRaw, setSpeakersRaw] = useState(""); // 빈 값 = 자동
  const [nameInputs, setNameInputs] = useState<string[]>([]);
  const check = validateSpeakers(speakersRaw);
  const estimate = diarizeEstimate(entry.durationSec);

  function submit() {
    if (!check.ok) {
      toast.show(check.message, { variant: "down" });
      return;
    }
    const names = buildNames(nameInputs, check.speakers);
    if (!names.ok) {
      toast.show(names.message, { variant: "down" });
      return;
    }
    diarize.mutate(
      { base: entry.base, speakers: check.speakers, names: names.names },
      {
        onSuccess: () => {
          toast.show("화자분리를 시작했습니다.", { variant: "ok" });
          onStarted?.();
        },
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!diarize.isPending) submit();
      }}
    >
      <Field label="인원 수" hint={`비우면 자동, ${MIN_SPEAKERS}~${MAX_SPEAKERS}명`}>
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_SPEAKERS}
          max={MAX_SPEAKERS}
          step={1}
          value={speakersRaw}
          onChange={(e) => setSpeakersRaw(e.target.value)}
          placeholder="인원 수를 입력하세요"
        />
      </Field>
      {check.ok ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: check.speakers }, (_, i) => (
            <Field key={i} label={`화자 ${i + 1} 이름`}>
              <Input
                value={nameInputs[i] ?? ""}
                maxLength={MAX_NAME_LEN}
                onChange={(e) =>
                  setNameInputs((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                placeholder="이름 (선택)"
              />
            </Field>
          ))}
        </div>
      ) : null}
      <Text variant="caption" color="muted" as="div">
        {check.ok && check.speakers === 0
          ? "인원 수를 비우면 목소리로 사람 수를 판단합니다. 이름은 나눈 뒤 화자 이름을 눌러 바꿉니다. 10명 이상 모임은 인원 수를 입력하세요."
          : "이름은 앞 화자부터 차례로 입력합니다."}{" "}
        화자분리는 이 맥에서 실행됩니다.
        {estimate ? ` ${estimate}` : ""}
      </Text>
      <Actions>
        <Button type="submit" variant="primary" size="sm" disabled={diarize.isPending || !check.ok}>
          {actionLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        ) : null}
      </Actions>
    </form>
  );
}

// ── Claude 교정 후보 ─────────────────────────────────────────────────────────

function CorrectionsAction({
  base,
  rerun = false,
  inline = false,
  failedChunks,
}: {
  base: string;
  rerun?: boolean;
  inline?: boolean;
  failedChunks?: number[];
}) {
  const toast = useToast();
  const corrections = useCorrectionsRecording();
  const canRetryFailed = !!failedChunks && failedChunks.length > 0;

  function run(retryFailed: boolean) {
    corrections.mutate(
      { base, retryFailed },
      {
        onSuccess: () => toast.show("고칠 곳 찾기를 시작했습니다.", { variant: "ok" }),
        onError: (err) => toast.show(processingErrorMessage(err), { variant: "down" }),
      },
    );
  }

  const buttons = (
    <>
      {canRetryFailed ? (
        <Button variant="primary" size="sm" disabled={corrections.isPending} onClick={() => run(true)}>
          실패한 부분만 다시 실행
        </Button>
      ) : null}
      <Button
        variant={rerun && !canRetryFailed ? "primary" : "secondary"}
        size="sm"
        disabled={corrections.isPending}
        onClick={() => run(false)}
      >
        {rerun ? "다시 실행" : "Claude 로 고칠 곳 찾기"}
      </Button>
    </>
  );
  if (inline) return buttons;
  return (
    <div className="space-y-2">
      <Actions>{buttons}</Actions>
      <Text variant="caption" color="muted" as="div">
        전사 내용이 Claude 로 전송됩니다.
      </Text>
    </div>
  );
}

// ── 연결 (교정본) ────────────────────────────────────────────────────────────

type LinkTarget = { kind: "memo"; memo: MemoRef } | { kind: "new"; title: string; folder: string };

function LinkCard({ item, onLinked }: { item: RecordingItem; onLinked: () => void }) {
  const { entry } = item;
  const toast = useToast();
  const meetingsQ = useMeetings();
  const link = useLinkRecording();
  const memos = useMemo<MemoRef[]>(() => meetingsQ.data ?? [], [meetingsQ.data]);
  const candidates = useMemo(() => {
    const r = rankLinkCandidates(entry, memos);
    return [...r.inWindow, ...r.sameDate].slice(0, CANDIDATE_LIMIT);
  }, [entry, memos]);
  const [mode, setMode] = useState<"none" | "search" | "new">("none");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("inbox");
  const [target, setTarget] = useState<LinkTarget | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return memos
      .filter((m) => !m.audio.includes(entry.base) && (m.title || "").toLowerCase().includes(q))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SEARCH_LIMIT);
  }, [memos, query, entry.base]);

  async function doLink(t: LinkTarget) {
    const vars: LinkVars =
      t.kind === "memo"
        ? { base: entry.base, memoUid: t.memo.uid }
        : { base: entry.base, newMemo: { title: t.title, folder: t.folder || undefined } };
    try {
      await link.link(vars);
      setTarget(null);
      const name = t.kind === "memo" ? t.memo.title?.trim() : t.title;
      toast.show(name ? `'${name}' 메모에 연결했습니다.` : "메모에 연결했습니다.", { variant: "ok" });
      onLinked();
    } catch (err) {
      setTarget(null);
      toast.show(recordingErrorMessage(err), { variant: "down" });
    }
  }

  const orphanPath = typeof entry.orphan === "string" ? entry.orphan : null;

  return (
    <StepCard title="메모에 연결">
      {orphanPath ? (
        <Alert
          variant="info"
          title="연결 정보가 없는 전사본 섹션이 있습니다"
          action={
            <Button
              size="sm"
              disabled={link.isPending}
              onClick={() =>
                link
                  .link({ base: entry.base, memoPath: orphanPath })
                  .then(() => toast.show("연결 정보를 복구했습니다.", { variant: "ok" }))
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

      {candidates.length > 0 ? (
        <MemoRows memos={candidates} disabled={link.isPending} onPick={(m) => setTarget({ kind: "memo", memo: m })} />
      ) : (
        <Text variant="caption" color="muted" as="div">
          같은 날짜 메모가 없습니다. 다른 메모를 찾거나 새 메모로 만드세요.
        </Text>
      )}

      <Actions>
        <Button size="sm" variant={mode === "search" ? "secondary" : "ghost"} onClick={() => setMode(mode === "search" ? "none" : "search")}>
          다른 메모 찾기
        </Button>
        <Button size="sm" variant={mode === "new" ? "secondary" : "ghost"} onClick={() => setMode(mode === "new" ? "none" : "new")}>
          새 메모로 만들기
        </Button>
      </Actions>

      {mode === "search" ? (
        <div className="space-y-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="메모 제목을 검색하세요" autoFocus />
          {query.trim() ? (
            results.length > 0 ? (
              <MemoRows memos={results} disabled={link.isPending} onPick={(m) => setTarget({ kind: "memo", memo: m })} />
            ) : (
              <Text variant="caption" color="muted" as="div">
                일치하는 메모가 없습니다.
              </Text>
            )
          ) : null}
        </div>
      ) : null}

      {mode === "new" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || link.isPending) return;
            setTarget({ kind: "new", title: title.trim(), folder: folder.trim() });
          }}
        >
          <Field label="제목" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목을 입력하세요" autoFocus />
          </Field>
          <Field label="폴더" hint="비우면 inbox 에 만듭니다.">
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="폴더를 입력하세요" />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={link.isPending || !title.trim()}>
            만들기
          </Button>
        </form>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        title={LINK_CONFIRM_TITLE}
        message={LINK_CONFIRM_MESSAGE}
        confirmLabel="연결"
        cancelLabel="취소"
        busy={link.isPending}
        onConfirm={() => target && void doLink(target)}
        onCancel={() => setTarget(null)}
      />
    </StepCard>
  );
}

function MemoRows({
  memos,
  disabled,
  onPick,
}: {
  memos: readonly MemoRef[];
  disabled: boolean;
  onPick: (m: MemoRef) => void;
}) {
  return (
    <ListGroup>
      {memos.map((m) => (
        <ListRow
          key={m.uid}
          label={<span className="block min-w-0 truncate">{m.title?.trim() || "(제목 없음)"}</span>}
          value={m.date ? formatDisplayDate(m.date) : undefined}
          disabled={disabled}
          onClick={() => onPick(m)}
        />
      ))}
    </ListGroup>
  );
}
