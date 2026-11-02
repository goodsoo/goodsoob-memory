import { useState } from "react";
import { useToast } from "@goodsoob/ds";
import { ConfirmDialog } from "../ConfirmDialog";
import { useDeleteRecordings } from "../../hooks/useRecordings";
import { recordingErrorMessage } from "./recordingLabels";

export const DELETE_MESSAGE = "휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.";

/**
 * 녹음 삭제 흐름 — 확인 → `POST /api/recordings/delete` → 결과 안내. 사이드바(다중 선택)와
 * 상세(⋯ 메뉴)가 같이 쓴다. `onDeleted` 로 실제 지워진 base 를 넘긴다(다음 녹음으로 이동용).
 */
export function useRecordingDelete(onDeleted: (deleted: string[]) => void) {
  const [pending, setPending] = useState<string[] | null>(null);
  const del = useDeleteRecordings();
  const toast = useToast();

  async function confirm() {
    if (!pending) return;
    const bases = pending;
    try {
      const r = await del.mutateAsync(bases);
      setPending(null);
      if (r.deleted.length > 0) {
        toast.show(`녹음 ${r.deleted.length}개를 휴지통으로 옮겼습니다.`, { variant: "ok" });
        onDeleted(r.deleted);
      }
      if (r.failed.length > 0) {
        toast.show(`녹음 ${r.failed.length}개는 삭제하지 못했습니다. ${r.failed[0].error}`, { variant: "down" });
      }
    } catch (err) {
      setPending(null);
      toast.show(`녹음을 삭제하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" });
    }
  }

  const n = pending?.length ?? 0;
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={n === 1 ? "이 녹음을 삭제하시겠습니까?" : `녹음 ${n}개를 삭제하시겠습니까?`}
      message={DELETE_MESSAGE}
      confirmLabel="삭제"
      danger
      busy={del.isPending}
      onConfirm={() => void confirm()}
      onCancel={() => setPending(null)}
    />
  );

  return {
    request: (bases: readonly string[]) => {
      if (bases.length > 0) setPending([...bases]);
    },
    isPending: del.isPending,
    dialog,
  };
}
