import { useCallback, useEffect, useMemo } from "react";
import { Mic } from "lucide-react";
import { useToast } from "@goodsoob/ds";
import { EmptyState } from "../components/common/EmptyState";
import { PageHeaderBar } from "../components/common/PageHeaderBar";
import { Text } from "../components/common/Text";
import { RecordingDetail } from "../components/recordings/RecordingDetail";
import { recordingErrorMessage } from "../components/recordings/recordingLabels";
import { useLinkRecording, useRecordings } from "../hooks/useRecordings";
import { groupInbox, nextAfterRemoval } from "../lib/recordings/inbox";
import { needsMoveRepair } from "../lib/recordings/merge";

export type SelectRecording = (base: string, opts?: { replace?: boolean }) => void;

type Props = {
  selectedBase: string | null;
  onSelect: SelectRecording;
  /** 선택 해제 (처리할 것이 비었을 때). */
  onClear: () => void;
  onOpenMeeting: (uid: string) => void;
};

// "이사 미완료" 자동 복구는 세션당 base 1회 (실패가 반복 toast 되지 않게).
const REPAIR_ATTEMPTED = new Set<string>();

// 녹음 탭 = 인박스이자 작업대 (docs/designs/recording-ux.md). 상세는 RecordingDetail.
// 진입 시 새 녹음 맨 위를 연다. 보내기·삭제가 끝나면 새 녹음의 다음 녹음으로.
export function RecordingsPage({ selectedBase, onSelect, onClear, onOpenMeeting }: Props) {
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
        toast.show(`메모로 옮기던 기록을 마무리하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" });
      });
    }
    // link·toast 는 매 렌더 새 객체 — items 변화에만 반응.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const groups = useMemo(() => (items ? groupInbox(items) : null), [items]);
  const todoOrder = useMemo(() => groups?.todo.map((i) => i.entry.base) ?? [], [groups]);

  // 진입 시 처리할 것 맨 위 자동 선택 (history 는 replace — 뒤로가기가 빈 화면에 멈추지 않게).
  useEffect(() => {
    if (selectedBase || todoOrder.length === 0) return;
    onSelect(todoOrder[0], { replace: true });
  }, [selectedBase, todoOrder, onSelect]);

  const selected = items?.find((i) => i.entry.base === selectedBase) ?? null;

  const advanceAfterDelete = useCallback(
    (deleted: string[]) => {
      if (!selectedBase || !deleted.includes(selectedBase)) return;
      const next = nextAfterRemoval(todoOrder, deleted, selectedBase);
      if (next) onSelect(next);
      else onClear();
    },
    [selectedBase, todoOrder, onSelect, onClear],
  );
  const advanceAfterLink = useCallback(
    (base: string) => {
      const next = nextAfterRemoval(todoOrder, [base], base);
      if (next) onSelect(next);
    },
    [todoOrder, onSelect],
  );

  // 바깥 div = relative (찾기 바 기준점). 상세는 스크롤 영역·찾기 바·재생 막대를 형제로 렌더한다.
  return (
    <div className="relative flex min-h-svh flex-col lg:h-full lg:min-h-0">
      <PageHeaderBar
        center={
          <Text variant="h4" as="h2">
            녹음
          </Text>
        }
      />
      {selected ? (
        <RecordingDetail
          key={selected.entry.base}
          item={selected}
          onOpenMeeting={onOpenMeeting}
          onSent={() => advanceAfterLink(selected.entry.base)}
          onDeleted={advanceAfterDelete}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="recording-scroll">
          {isLoading ? null : selectedBase ? (
            <EmptyState
              className="px-6 py-16"
              title="녹음을 찾을 수 없습니다"
              description="녹음 파일이 옮겨졌거나 삭제됐을 수 있습니다. 목록에서 다른 녹음을 선택하세요."
            />
          ) : todoOrder.length === 0 ? (
            <EmptyState
              className="px-6 py-16"
              icon={<Mic className="h-6 w-6" aria-hidden />}
              title="새 녹음이 없습니다"
              description="음성 메모가 받아쓰기를 마치면 여기에 나타납니다. 지난 녹음은 왼쪽 정리 끝에서 엽니다."
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
