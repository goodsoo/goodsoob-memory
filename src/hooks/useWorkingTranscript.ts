import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@goodsoob/ds";
import {
  putRecordingTranscript,
  RecordingApiError,
  type TranscriptSource,
} from "../api/recordings";
import { recordingErrorMessage } from "../components/recordings/recordingLabels";
import { emptyHistory, push, redo as redoHistory, undo as undoHistory, type TextHistory } from "../lib/recordings/textHistory";
import { transcriptKey, useRecordingTranscript } from "./useRecordings";

export const SAVE_DEBOUNCE_MS = 800;

export interface WorkingTranscript {
  text: string;
  source: TranscriptSource;
}

/**
 * 녹음 탭 작업 파일 편집 — GET 으로 읽고, 고치면 800ms 뒤 PUT (mtime 충돌 검사).
 * 저장은 한 줄로 직렬화한다(앞 저장의 새 mtime 으로 다음 저장). 409 conflict 면 서버 값을
 * 다시 읽어 덮고 안내한다. 언마운트(다른 녹음 선택) 시 남은 저장을 내보낸다.
 */
export function useWorkingTranscript(base: string, version: string, enabled: boolean) {
  const q = useRecordingTranscript(base, version, enabled);
  const qc = useQueryClient();
  const toast = useToast();
  const [local, setLocal] = useState<WorkingTranscript | null>(null);
  const textRef = useRef<string | null>(null);
  const mtimeRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const historyRef = useRef<TextHistory>(emptyHistory());
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const syncHist = useCallback(() => {
    const h = historyRef.current;
    setHist({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }, []);

  // 서버 값 반영 — 고치는 중(dirty)이면 덮지 않는다.
  useEffect(() => {
    if (!q.data || dirtyRef.current) return;
    textRef.current = q.data.text;
    mtimeRef.current = q.data.mtime;
    // 서버 값으로 덮으면 되돌리기 기준이 사라지므로 스택을 비운다.
    historyRef.current = emptyHistory();
    syncHist();
    setLocal({ text: q.data.text, source: q.data.source });
  }, [q.data, syncHist]);

  const save = useCallback((): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    chainRef.current = chainRef.current.then(async () => {
      if (!dirtyRef.current || textRef.current === null) return true;
      const text = textRef.current;
      try {
        const r = await putRecordingTranscript(base, text, mtimeRef.current);
        mtimeRef.current = r.mtime;
        if (textRef.current === text) dirtyRef.current = false;
        return true;
      } catch (err) {
        if (err instanceof RecordingApiError && err.code === "conflict") {
          dirtyRef.current = false;
          historyRef.current = emptyHistory();
          syncHist();
          await qc.refetchQueries({ queryKey: [...transcriptKey(base), version] });
          toast.show("다른 곳에서 내용이 바뀌어 새로 불러왔습니다. 방금 고친 곳을 다시 고치세요.", {
            variant: "warn",
          });
        } else {
          toast.show(`고친 내용을 저장하지 못했습니다. ${recordingErrorMessage(err)}`, { variant: "down" });
        }
        return false;
      }
    });
    return chainRef.current;
  }, [base, version, qc, toast, syncHist]);

  const apply = useCallback(
    (next: string) => {
      textRef.current = next;
      dirtyRef.current = true;
      setLocal((prev) => (prev ? { ...prev, text: next } : prev));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  const setText = useCallback(
    (next: string) => {
      const prev = textRef.current;
      if (prev !== null && prev !== next) {
        historyRef.current = push(historyRef.current, prev);
        syncHist();
      }
      apply(next);
    },
    [apply, syncHist],
  );

  const undo = useCallback((): boolean => {
    const cur = textRef.current;
    if (cur === null) return false;
    const res = undoHistory(historyRef.current, cur);
    if (!res) return false;
    historyRef.current = res.history;
    syncHist();
    apply(res.text);
    return true;
  }, [apply, syncHist]);

  const redo = useCallback((): boolean => {
    const cur = textRef.current;
    if (cur === null) return false;
    const res = redoHistory(historyRef.current, cur);
    if (!res) return false;
    historyRef.current = res.history;
    syncHist();
    apply(res.text);
    return true;
  }, [apply, syncHist]);

  /** 지금 바로 저장 (수락·교정 완료 직전). 실패면 false. */
  const flush = useCallback(() => save(), [save]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (dirtyRef.current) void saveRef.current();
    },
    [],
  );

  return {
    data: local,
    isLoading: q.isLoading,
    error: q.error,
    setText,
    flush,
    undo,
    redo,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
  };
}
