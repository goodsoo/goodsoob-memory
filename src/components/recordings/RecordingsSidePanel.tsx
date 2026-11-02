import { useState } from "react";
import { CloudDownload } from "lucide-react";
import { Chip, NavItem } from "@goodsoob/ds";
import { Text } from "../common/Text";
import { SidePanelSectionHeader } from "../nav/SidePanel";
import { useRecordings } from "../../hooks/useRecordings";
import { GROUP_LABELS, groupRecordings, type GroupId, type RecordingItem } from "../../lib/recordings/merge";
import {
  PIPELINE_LABELS,
  formatDuration,
  pipelineChipVariant,
  recordingWhen,
} from "./recordingLabels";

const SHOW_TEXT_ONLY_KEY = "goodsoob:recordingsShowTextOnly";
const COLLAPSED_KEY = "goodsoob:recordingsCollapsed";

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string): void {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    // private window 등 — 기억만 못 함
  }
}

type Props = {
  selectedBase: string | null;
  onSelect: (base: string) => void;
};

// 녹음 탭 사이드바 — 행선지 축으로 그룹(미정 / 연결됨 / 휴지통 / 보관됨 / 전사본 없음),
// 각 그룹 안은 서버 정렬(날짜 desc). 행 = 녹음 시각 · 길이 · 파이프라인 칩 · 연결된 메모 제목.
export function RecordingsSidePanel({ selectedBase, onSelect }: Props) {
  const { items, isLoading, isError } = useRecordings();
  const [showTextOnly, setShowTextOnly] = useState(() => readLS(SHOW_TEXT_ONLY_KEY) === "1");
  const [collapsed, setCollapsed] = useState<Set<GroupId>>(() => {
    const raw = readLS(COLLAPSED_KEY);
    // 기본 = 전부 펼침. 접은 그룹만 localStorage 에 기억.
    return new Set((raw ? raw.split(",") : []) as GroupId[]);
  });

  const textOnlyCount = items?.filter((i) => i.status.pipeline === "textOnly").length ?? 0;
  const groups = items ? groupRecordings(items, showTextOnly) : [];

  function toggleGroup(id: GroupId) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeLS(COLLAPSED_KEY, [...next].join(","));
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-4"
        style={{ height: "var(--page-header-h)", borderBottom: "1px solid var(--line)" }}
      >
        <h2 className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>
          녹음
        </h2>
        {textOnlyCount > 0 ? (
          <Chip
            size="sm"
            selectable
            selected={showTextOnly}
            onClick={() => {
              const next = !showTextOnly;
              setShowTextOnly(next);
              writeLS(SHOW_TEXT_ONLY_KEY, next ? "1" : "0");
            }}
            title="녹음 파일 없이 전사본만 있는 항목"
          >
            텍스트만 {textOnlyCount}
          </Chip>
        ) : null}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col" aria-label="녹음">
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {isLoading ? null : isError ? (
            <Text variant="caption" color="danger" as="div" className="px-4 py-2">
              녹음 목록을 불러오지 못했습니다. 앱 서버가 켜져 있는지 확인하세요.
            </Text>
          ) : groups.length === 0 ? (
            <Text variant="caption" color="muted" as="div" className="px-4 py-2">
              녹음이 없습니다
            </Text>
          ) : (
            groups.map((g) => (
              <div key={g.id}>
                <SidePanelSectionHeader
                  label={GROUP_LABELS[g.id]}
                  collapsed={collapsed.has(g.id)}
                  onToggle={() => toggleGroup(g.id)}
                  count={g.items.length}
                />
                {!collapsed.has(g.id) ? (
                  <div className="px-1 pb-2">
                    {g.items.map((it) => (
                      <RecordingRow
                        key={it.entry.base}
                        item={it}
                        active={it.entry.base === selectedBase}
                        onSelect={() => onSelect(it.entry.base)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </nav>
    </div>
  );
}

function RecordingRow({
  item,
  active,
  onSelect,
}: {
  item: RecordingItem;
  active: boolean;
  onSelect: () => void;
}) {
  const { entry, status } = item;
  const memoTitle =
    item.memos[0]?.title?.trim() || item.trashedMemos[0]?.title?.trim() || null;
  const duration = formatDuration(entry.durationSec);
  return (
    <NavItem active={active} onClick={onSelect} aria-current={active ? "true" : undefined}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>
            {recordingWhen(entry)}
          </span>
          {duration ? (
            <span className="shrink-0 text-2xs tabular-nums whitespace-nowrap" style={{ color: "var(--faint)" }}>
              {duration}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <Chip size="sm" variant={pipelineChipVariant(status.pipeline)}>
            {PIPELINE_LABELS[status.pipeline]}
          </Chip>
          {entry.syncPending ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-2xs whitespace-nowrap"
              style={{ color: "var(--faint)" }}
              title="녹음 파일이 아직 이 맥으로 동기화되지 않았습니다"
            >
              <CloudDownload className="h-3 w-3" aria-hidden />
              동기화 대기
            </span>
          ) : null}
          {status.destination === "moveIncomplete" ? (
            <span className="shrink-0 text-2xs whitespace-nowrap" style={{ color: "var(--warn-ink)" }}>
              이사 미완료
            </span>
          ) : null}
          {memoTitle ? (
            <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--sub)" }}>
              {memoTitle}
            </span>
          ) : null}
        </span>
      </span>
    </NavItem>
  );
}
