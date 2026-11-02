import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Mic } from "lucide-react";
import { Alert, Chip, Field, Input, NavItem, Segment, useToast } from "@goodsoob/ds";
import { Button } from "../components/common/Button";
import { EmptyState } from "../components/common/EmptyState";
import { PageHeaderBar } from "../components/common/PageHeaderBar";
import { Text } from "../components/common/Text";
import { AudioPlayer } from "../components/recordings/AudioPlayer";
import {
  PIPELINE_LABELS,
  formatDuration,
  pipelineChipVariant,
  recordingErrorMessage,
  recordingSubtitle,
  recordingWhen,
} from "../components/recordings/recordingLabels";
import { useMeetings, useRestoreMeeting } from "../hooks/useMeetings";
import {
  useArchiveRecording,
  useLinkRecording,
  useMoveRecording,
  useRecordings,
  useRecordingTranscript,
  useUnarchiveRecording,
  useUnlinkRecording,
} from "../hooks/useRecordings";
import { formatDisplayDate } from "../lib/dates";
import {
  needsMoveRepair,
  rankLinkCandidates,
  type MemoRef,
  type RecordingItem,
} from "../lib/recordings/merge";

type Props = {
  selectedBase: string | null;
  onSelect: (base: string) => void;
  onOpenMeeting: (uid: string) => void;
};

// "이사 미완료" 자동 복구는 세션당 base 1회 (실패가 반복 toast 되지 않게).
const REPAIR_ATTEMPTED = new Set<string>();

export function RecordingsPage({ selectedBase, onSelect, onOpenMeeting }: Props) {
  const { items, isLoading } = useRecordings();
  const link = useLinkRecording();
  const toast = useToast();

  // 탭 진입 시 "이사 미완료" 녹음을 조용히 마무리 (서버 link 는 멱등).
  useEffect(() => {
    if (!items) return;
    for (const it of items) {
      if (!needsMoveRepair(it) || REPAIR_ATTEMPTED.has(it.entry.base)) continue;
      REPAIR_ATTEMPTED.add(it.entry.base);
      link.link({ base: it.entry.base, memoUid: it.memos[0].uid }).catch((err) => {
        toast.show(`녹음 이사를 마무리하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" });
      });
    }
    // link·toast 는 매 렌더 새 객체 — items 변화에만 반응.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const selected = items?.find((i) => i.entry.base === selectedBase) ?? null;
  const undecided = items?.filter((i) => i.status.destination === "undecided" && i.status.pipeline !== "textOnly") ?? [];

  return (
    <div className="flex min-h-svh flex-col lg:h-full lg:min-h-0">
      <PageHeaderBar
        center={
          <Text variant="h4" as="h2">
            녹음
          </Text>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <RecordingDetail key={selected.entry.base} item={selected} onOpenMeeting={onOpenMeeting} />
        ) : isLoading ? null : selectedBase ? (
          <EmptyState
            className="px-6 py-16"
            title="녹음을 찾을 수 없습니다"
            description="녹음 파일이 옮겨졌거나 삭제됐을 수 있습니다. 목록에서 다른 녹음을 선택하세요."
          />
        ) : undecided.length > 0 ? (
          <EmptyState
            className="px-6 py-16"
            icon={<Mic className="h-6 w-6" aria-hidden />}
            title={`행선지를 정하지 않은 녹음이 ${undecided.length}개 있습니다`}
            description="녹음을 열어 기존 메모에 연결하거나, 새 메모로 만들거나, 전사만 보관하세요."
            action={
              <Button variant="primary" onClick={() => onSelect(undecided[0].entry.base)}>
                첫 녹음 열기
              </Button>
            }
          />
        ) : (
          <EmptyState
            className="px-6 py-16"
            icon={<Mic className="h-6 w-6" aria-hidden />}
            title="처리할 녹음이 없습니다"
            description="새 녹음은 전사가 끝나면 이 목록에 나타납니다. 왼쪽에서 지난 녹음을 열 수 있습니다."
          />
        )}
      </div>
    </div>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────

function RecordingDetail({
  item,
  onOpenMeeting,
}: {
  item: RecordingItem;
  onOpenMeeting: (uid: string) => void;
}) {
  const { entry, status } = item;
  const subtitle = recordingSubtitle(entry);
  const duration = formatDuration(entry.durationSec);
  const linked = status.destination === "linked" || status.destination === "moveIncomplete";
  // 연결 전 전사본만 미리보기 (연결 후엔 메모 음성 기록 탭이 정본).
  const showPreview = !linked && status.destination !== "trash";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-6">
      <header className="space-y-1.5">
        <Text variant="h3" as="h3">
          {recordingWhen(entry)}
        </Text>
        {subtitle ? (
          <Text variant="body" color="secondary">
            {subtitle}
          </Text>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant={pipelineChipVariant(status.pipeline)}>
            {PIPELINE_LABELS[status.pipeline]}
          </Chip>
          {duration ? (
            <Text variant="caption" color="muted" as="span" className="tabular-nums">
              {duration}
            </Text>
          ) : null}
          <Text variant="caption" color="muted" as="span" className="font-mono break-all">
            {entry.base}
          </Text>
        </div>
      </header>

      {status.pipeline === "processing" && entry.job?.step ? (
        <Alert variant="info">전사 작업이 진행 중입니다 ({entry.job.step}).</Alert>
      ) : null}
      {status.pipeline === "error" ? (
        <Alert variant="down" title="전사 작업이 실패했습니다">
          {entry.job?.error || "작업이 중단됐습니다."} 터미널에서 /transcribe 로 다시 실행하세요.
        </Alert>
      ) : null}

      {entry.hasM4a ? <AudioPlayer base={entry.base} syncPending={entry.syncPending} /> : null}

      <DestinationPanel item={item} onOpenMeeting={onOpenMeeting} />

      {showPreview ? <TranscriptPreview item={item} /> : null}
    </div>
  );
}

function TranscriptPreview({ item }: { item: RecordingItem }) {
  const { entry, status } = item;
  const q = useRecordingTranscript(entry, true);
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Text variant="body" weight="semibold" as="h4">
          전사 미리보기
        </Text>
        {q.data?.raw ? (
          <Chip size="sm" title="whisper 초벌 전사 (교정 전)">
            초벌
          </Chip>
        ) : null}
      </div>
      {q.isLoading ? null : q.isError ? (
        <Text variant="caption" color="danger" as="div">
          전사본을 읽지 못했습니다. 파일이 동기화됐는지 확인하세요.
        </Text>
      ) : q.data ? (
        <pre
          className="max-h-96 overflow-y-auto rounded-md px-3 py-2 text-sm whitespace-pre-wrap"
          style={{
            fontFamily: "inherit",
            color: "var(--ink)",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          {q.data.text}
        </pre>
      ) : (
        <Text variant="caption" color="muted" as="div">
          {status.pipeline === "waiting" ? "아직 전사 전입니다. 전사가 끝나면 여기에 보입니다." : "전사본이 없습니다."}
        </Text>
      )}
    </section>
  );
}

// ── 행선지 ───────────────────────────────────────────────────────────────────

function DestinationPanel({
  item,
  onOpenMeeting,
}: {
  item: RecordingItem;
  onOpenMeeting: (uid: string) => void;
}) {
  const { entry, status } = item;
  const toast = useToast();
  const meetingsQ = useMeetings();
  const link = useLinkRecording();
  const unlink = useUnlinkRecording();
  const move = useMoveRecording();
  const archive = useArchiveRecording();
  const unarchive = useUnarchiveRecording();
  const restore = useRestoreMeeting();
  const [moving, setMoving] = useState(false);
  const busy =
    link.isPending || unlink.isPending || move.isPending || archive.isPending || unarchive.isPending || restore.isPending;

  const fail = (err: unknown) => toast.show(recordingErrorMessage(err), { variant: "down" });

  // 전사본이 아직 없으면 연결·보관 불가 (서버 409 noTranscript).
  const hasTranscript = entry.hasTxt || entry.stt.moved || entry.stt.done;

  async function linkTo(memoUid: string) {
    try {
      await link.link({ base: entry.base, memoUid });
      // 보관됨에서 연결하면 archived 마커를 지워 두 값이 겹치지 않게 (해제 시 미정으로 돌아감).
      if (entry.stt.archived) await unarchive.mutateAsync(entry.base).catch(() => undefined);
      const title = meetingsQ.data?.find((m) => m.uid === memoUid)?.title?.trim();
      toast.show(title ? `'${title}' 메모에 연결했습니다.` : "메모에 연결했습니다.", { variant: "ok" });
    } catch (err) {
      fail(err);
    }
  }

  async function createMemo(title: string, folder: string) {
    try {
      const r = await link.link({ base: entry.base, newMemo: { title, folder } });
      if (entry.stt.archived) await unarchive.mutateAsync(entry.base).catch(() => undefined);
      onOpenMeeting(r.meeting.uid);
    } catch (err) {
      fail(err);
    }
  }

  async function doArchive() {
    try {
      await archive.mutateAsync(entry.base);
      toast.show("전사본을 보관했습니다.", { variant: "ok" });
    } catch (err) {
      fail(err);
    }
  }

  // ── 연결됨 ──
  if (status.destination === "linked" || status.destination === "moveIncomplete") {
    const memo = item.memos[0];
    async function doUnlink() {
      try {
        const r = await unlink.unlink({ base: entry.base, memoUid: memo.uid });
        toast.show(
          r.textKept
            ? "연결을 해제했습니다. 섹션 제목을 찾지 못해 전사본은 메모에 남아 있습니다."
            : "연결을 해제했습니다. 전사본은 녹음 쪽으로 돌아왔습니다.",
          { variant: r.textKept ? "warn" : "ok" },
        );
      } catch (err) {
        fail(err);
      }
    }
    async function doMove(toUid: string) {
      try {
        const r = await move.move({ base: entry.base, fromUid: memo.uid, toUid });
        if (!r.link) {
          toast.show(
            "연결은 해제했지만 이동하지 못했습니다. 옛 메모의 섹션 제목을 찾지 못해 전사본이 그 메모에 남아 있습니다.",
            { variant: "warn" },
          );
        } else {
          toast.show("다른 메모로 옮겼습니다.", { variant: "ok" });
        }
        setMoving(false);
      } catch (err) {
        fail(err);
      }
    }
    return (
      <PanelSection title="행선지">
        {item.memos.map((m) => (
          <MemoLine key={m.uid} memo={m} onOpen={() => onOpenMeeting(m.uid)} />
        ))}
        {status.destination === "moveIncomplete" ? (
          <Text variant="caption" color="muted" as="div">
            전사본 이사가 끝나지 않았습니다. 녹음 탭에 들어오면 자동으로 마무리합니다.
          </Text>
        ) : (
          <Text variant="caption" color="muted" as="div">
            전사본은 이 메모의 음성 기록 탭에 있습니다.
          </Text>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void doUnlink()}>
            연결 해제
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMoving((v) => !v)}>
            다른 메모로 이동
          </Button>
        </div>
        {moving ? (
          <MemoChooser
            item={item}
            memos={meetingsQ.data ?? []}
            excludeUid={memo.uid}
            actionLabel="이동"
            busy={busy}
            onChoose={(uid) => void doMove(uid)}
          />
        ) : null}
      </PanelSection>
    );
  }

  // ── 휴지통 ──
  if (status.destination === "trash") {
    const memo = item.trashedMemos[0];
    return (
      <PanelSection title="행선지">
        <Text variant="body" color="secondary">
          이 녹음이 연결된 메모 &apos;{memo?.title?.trim() || "제목 없음"}&apos; 가 휴지통에 있습니다.
          메모를 복원하면 전사본도 함께 돌아옵니다.
        </Text>
        <div>
          <Button
            size="sm"
            disabled={busy || !memo}
            onClick={() =>
              restore.mutate(memo.id, {
                onSuccess: () => toast.show("메모를 복원했습니다.", { variant: "ok" }),
                onError: () =>
                  toast.show("메모 복원에 실패했습니다. 휴지통에서 다시 시도하세요.", { variant: "down" }),
              })
            }
          >
            메모 복원
          </Button>
        </div>
      </PanelSection>
    );
  }

  // ── 전사본 없음 ──
  if (status.destination === "transcriptMissing") {
    return (
      <PanelSection title="행선지">
        <Alert variant="warn" title="전사본을 찾을 수 없습니다">
          연결됐던 메모가 휴지통에서 비워져 전사본도 함께 지워졌습니다. 초벌 전사로 다시 만드는 기능은 다음
          업데이트에서 지원합니다.
        </Alert>
      </PanelSection>
    );
  }

  // ── 보관됨 ──
  if (status.destination === "archived") {
    return (
      <PanelSection title="행선지">
        <Text variant="caption" color="muted" as="div">
          전사본만 보관 중입니다.
        </Text>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              unarchive.mutate(entry.base, {
                onSuccess: () => toast.show("보관을 취소했습니다.", { variant: "ok" }),
                onError: fail,
              })
            }
          >
            보관 취소
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMoving((v) => !v)}>
            메모에 연결
          </Button>
        </div>
        {moving ? (
          <MemoChooser
            item={item}
            memos={meetingsQ.data ?? []}
            actionLabel="연결"
            busy={busy}
            onChoose={(uid) => void linkTo(uid)}
          />
        ) : null}
      </PanelSection>
    );
  }

  // ── 미정 ──
  const orphanPath = typeof entry.orphan === "string" ? entry.orphan : null;
  return (
    <PanelSection title="행선지">
      {orphanPath ? (
        <Alert
          variant="info"
          title="연결 정보가 없는 전사본 섹션이 있습니다"
          action={
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                link
                  .link({ base: entry.base, memoPath: orphanPath })
                  .then(() => toast.show("연결 정보를 복구했습니다.", { variant: "ok" }))
                  .catch(fail)
              }
            >
              연결 복구
            </Button>
          }
        >
          <span className="break-all">{orphanPath}</span> 의 음성 기록에 이 녹음 섹션이 있습니다.
        </Alert>
      ) : null}
      {!hasTranscript ? (
        <Text variant="caption" color="muted" as="div">
          전사가 끝나면 행선지를 정할 수 있습니다.
        </Text>
      ) : (
        <UndecidedChooser
          item={item}
          memos={meetingsQ.data ?? []}
          busy={busy}
          onLink={(uid) => void linkTo(uid)}
          onCreate={(t, f) => void createMemo(t, f)}
          onArchive={() => void doArchive()}
        />
      )}
    </PanelSection>
  );
}

type Mode = "existing" | "new" | "archive";

function UndecidedChooser({
  item,
  memos,
  busy,
  onLink,
  onCreate,
  onArchive,
}: {
  item: RecordingItem;
  memos: MemoRef[];
  busy: boolean;
  onLink: (uid: string) => void;
  onCreate: (title: string, folder: string) => void;
  onArchive: () => void;
}) {
  const [mode, setMode] = useState<Mode>("existing");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("inbox");
  return (
    <div className="space-y-3">
      <Segment
        groupLabel="행선지"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: "existing", label: "기존 메모에 연결" },
          { value: "new", label: "새 메모로 만들기" },
          { value: "archive", label: "전사만 보관" },
        ]}
      />
      {mode === "existing" ? (
        <MemoChooser item={item} memos={memos} actionLabel="연결" busy={busy} onChoose={onLink} />
      ) : mode === "new" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || busy) return;
            onCreate(title.trim(), folder.trim());
          }}
        >
          <Field label="제목" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목을 입력하세요" autoFocus />
          </Field>
          <Field label="폴더" hint="비우면 inbox 에 만듭니다.">
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="폴더를 입력하세요" />
          </Field>
          <Text variant="caption" color="muted" as="div">
            본문은 비어 있고, 전사본은 음성 기록 탭으로 옮겨집니다. 날짜·시각은 녹음 시각으로 채웁니다.
          </Text>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>
            만들기
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <Text variant="caption" color="muted" as="div">
            메모 없이 전사본만 녹음 폴더에 남깁니다. 나중에 메모에 연결할 수 있습니다.
          </Text>
          <Button variant="primary" size="sm" disabled={busy} onClick={onArchive}>
            보관
          </Button>
        </div>
      )}
    </div>
  );
}

const SEARCH_LIMIT = 20;

/** 기존 메모 고르기 — 후보(녹음 중 수정 → 같은 날짜) + 제목 검색. */
function MemoChooser({
  item,
  memos,
  excludeUid,
  actionLabel,
  busy,
  onChoose,
}: {
  item: RecordingItem;
  memos: MemoRef[];
  excludeUid?: string;
  actionLabel: string;
  busy: boolean;
  onChoose: (uid: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const pool = useMemo(() => memos.filter((m) => m.uid !== excludeUid), [memos, excludeUid]);
  const ranked = useMemo(() => rankLinkCandidates(item.entry, pool), [item.entry, pool]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pool
      .filter((m) => !m.audio.includes(item.entry.base) && (m.title || "").toLowerCase().includes(q))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SEARCH_LIMIT);
  }, [pool, query, item.entry.base]);

  const groups: Array<{ label: string; list: MemoRef[] }> = query.trim()
    ? [{ label: "검색 결과", list: results }]
    : [
        { label: "녹음 중 수정한 메모", list: ranked.inWindow },
        { label: "같은 날짜 메모", list: ranked.sameDate },
      ].filter((g) => g.list.length > 0);

  return (
    <div className="space-y-2">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="메모 제목을 검색하세요" />
      <div className="max-h-72 overflow-y-auto">
        {groups.length === 0 ? (
          <Text variant="caption" color="muted" as="div" className="px-1 py-1.5">
            {query.trim() ? "일치하는 메모가 없습니다." : "같은 날짜 메모가 없습니다. 제목으로 검색하세요."}
          </Text>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="pb-1">
              <Text variant="caption" color="muted" as="div" className="px-1 pt-1.5 pb-0.5">
                {g.label}
              </Text>
              {g.list.map((m) => (
                <NavItem key={m.uid} active={picked === m.uid} onClick={() => setPicked(m.uid)}>
                  <span className="min-w-0 flex-1 truncate">{m.title?.trim() || "(제목 없음)"}</span>
                  {m.date ? (
                    <span className="shrink-0 text-2xs whitespace-nowrap" style={{ color: "var(--faint)" }}>
                      {formatDisplayDate(m.date)}
                    </span>
                  ) : null}
                </NavItem>
              ))}
            </div>
          ))
        )}
      </div>
      <Button variant="primary" size="sm" disabled={busy || !picked} onClick={() => picked && onChoose(picked)}>
        {actionLabel}
      </Button>
    </div>
  );
}

function MemoLine({ memo, onOpen }: { memo: MemoRef; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Text variant="body" weight="medium" as="span" className="min-w-0 flex-1 truncate">
        {memo.title?.trim() || "(제목 없음)"}
      </Text>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        메모 열기
      </Button>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <Text variant="body" weight="semibold" as="h4">
        {title}
      </Text>
      {children}
    </section>
  );
}
