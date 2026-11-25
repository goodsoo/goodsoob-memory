import { useCallback, useLayoutEffect, useRef } from "react";
import { useToast } from "@goodsoob/ds";
import { useDeleteMeeting, useUndoDeleteMeeting } from "./useMeetings";
import { formatError } from "../lib/errors";

/**
 * 메모를 휴지통으로 — 확인창 없이 바로 옮기고 "되돌리기" 토스트를 띄운다.
 * DS UX 규칙 U2(goodsoob-design-system docs/ux-patterns.md): 되돌릴 수 있는 삭제는
 * 확인 대신 되돌리기. 토스트는 8초·한 번에 하나(DS Toast action, #320). 놓쳐도 휴지통이 대체 경로.
 *
 * 되돌리기 = 원래 폴더·경로로 복원(휴지통 화면의 복원은 root 로 감 — undoDeleteMeeting 참고).
 * `trash(uid, { onRestored })` — 되돌리기 성공 시 onRestored(uid) 로 그 메모를 다시 열 수 있다.
 * 삭제 실패는 throw(호출부가 기존처럼 처리), 되돌리기 실패는 에러 토스트.
 */
export function useTrashMeetingWithUndo() {
  const del = useDeleteMeeting();
  const restore = useUndoDeleteMeeting();
  const toast = useToast();
  // 토스트 버튼은 8초 뒤에 눌릴 수 있다 — 그때의 최신 mutation/toast 를 쓰도록 ref 로 잡아 둔다.
  const ref = useRef({ del, restore, toast });
  useLayoutEffect(() => {
    ref.current = { del, restore, toast };
  });

  const trash = useCallback(
    async (uid: string, opts?: { onRestored?: (uid: string) => void }) => {
      const { trashId, path } = await ref.current.del.mutateAsync(uid);
      ref.current.toast.show("메모를 휴지통으로 옮겼습니다.", {
        action: {
          label: "되돌리기",
          onClick: () => {
            ref.current.restore
              .mutateAsync({ trashId, path })
              .then((m) => opts?.onRestored?.(m.uid))
              .catch((e) => ref.current.toast.show(formatError(e), { variant: "down" }));
          },
        },
      });
    },
    [],
  );

  return { trash, isPending: del.isPending };
}
