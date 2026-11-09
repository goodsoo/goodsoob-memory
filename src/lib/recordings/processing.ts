// 전사 처리 패널의 순수 로직 (step 라벨 · 소요 시간 추정 · 오류 코드 · 화자 입력 검증).
import type { RecordingJob } from "../../api/recordings";

export const MIN_SPEAKERS = 1;
export const MAX_SPEAKERS = 10;
export const MAX_NAME_LEN = 40;

const CORRECTIONS_STEP = /^corrections (\d+)\/(\d+)$/;

/** job.step → 진행 문구. 모르는 step 은 "처리 중". */
export function stepLabel(step: string | undefined): string {
  if (!step) return "처리 중";
  const m = CORRECTIONS_STEP.exec(step);
  if (m) return `고칠 곳 찾는 중 (${m[1]}/${m[2]})`;
  switch (step) {
    case "queued":
      return "순서를 기다리는 중";
    case "wav":
      return "녹음 파일 준비 중";
    case "diarize":
      return "말한 사람 나누는 중";
    case "merge":
      return "나눈 결과를 글에 맞추는 중";
    case "normalize":
      return "표기 정리 중";
    case "anchor":
      return "고칠 곳 위치 표시 중";
    case "done":
      return "마무리 중";
    default:
      return "처리 중";
  }
}

function hoursLabel(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${h}시간`;
}

/** 화자분리(pyannote, MPS)는 로컬에서 녹음 길이의 약 1/15 이 걸린다. null = 길이를 모르면 안내 생략. */
export function diarizeEstimate(durationSec: number | null): string | null {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const lenMin = durationSec / 60;
  const takeMin = Math.max(1, Math.round(lenMin / 15));
  const lenLabel = lenMin >= 60 ? hoursLabel(lenMin) : `${Math.max(1, Math.round(lenMin))}분`;
  const takeLabel = takeMin >= 60 ? hoursLabel(takeMin) : `${takeMin}분`;
  return `${lenLabel} 녹음은 약 ${takeLabel} 걸립니다.`;
}

export type SpeakersCheck = { ok: true; speakers: number } | { ok: false; message: string };

/** 화자 수 입력 문자열 검증. 빈 값 = 0(자동), 그 외 1~10 정수. */
export function validateSpeakers(raw: string): SpeakersCheck {
  const t = raw.trim();
  if (t === "") return { ok: true, speakers: 0 };
  if (!/^\d+$/.test(t)) return { ok: false, message: "인원 수는 1~10 사이 숫자로 입력하거나 비워 두세요." };
  const n = Number(t);
  if (n < MIN_SPEAKERS || n > MAX_SPEAKERS) return { ok: false, message: "인원 수는 1~10 사이 숫자로 입력하거나 비워 두세요." };
  return { ok: true, speakers: n };
}

/**
 * 화자 이름 입력 → 서버 names. 서버는 index 순 매핑이라 중간 빈칸을 허용하지 않는다:
 * 끝의 빈칸은 잘라내고, 그 앞에 빈칸이 남으면 오류.
 */
export function buildNames(
  inputs: readonly string[],
  speakers: number,
): { ok: true; names: string[] | undefined } | { ok: false; message: string } {
  const trimmed = inputs.slice(0, speakers).map((s) => s.trim());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  if (trimmed.length === 0) return { ok: true, names: undefined };
  if (trimmed.some((n) => n === "")) {
    return { ok: false, message: "이름은 첫 번째 사람부터 차례로 입력하세요. 비워 둘 칸은 뒤쪽에 두세요." };
  }
  if (trimmed.some((n) => n.length > MAX_NAME_LEN)) {
    return { ok: false, message: `이름은 ${MAX_NAME_LEN}자 이내로 입력하세요.` };
  }
  return { ok: true, names: trimmed };
}

/** 서버 `{code}` → 토스트 문구 (원인 + 해결). */
export function processingErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case "badSpeakers":
      return "인원 수가 올바르지 않습니다. 1~10 사이 숫자로 입력하거나 비워 두세요.";
    case "badNames":
      return "이름이 올바르지 않습니다. 40자 이내로, 인원 수보다 많지 않게 입력하세요.";
    case "notPro":
      return "이 작업은 Pro 맥에서만 실행됩니다. Pro 맥의 앱에서 다시 시도하세요.";
    case "noAudio":
      return "녹음 파일이 없어 처리할 수 없습니다. 녹음 파일을 확인하세요.";
    case "notTranscribed":
      return "자동 받아쓰기가 아직 끝나지 않았습니다. 끝난 뒤 다시 시도하세요.";
    case "notDiarized":
      return "말한 사람을 아직 나누지 않았습니다. 말한 사람 나누기를 먼저 실행하세요.";
    case "jobRunning":
      return "이미 처리 중인 작업이 있습니다. 끝난 뒤 다시 시도하세요.";
    case "busy":
      return "이 녹음은 다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.";
    case "noPartial":
      return "다시 실행할 실패 부분이 없습니다. 고칠 곳 찾기를 처음부터 다시 실행하세요.";
    case "spawnFailed":
      return "작업을 시작하지 못했습니다. 서버 로그를 확인하고 다시 시도하세요.";
    default:
      return e?.message || "요청에 실패했습니다. 잠시 후 다시 시도하세요.";
  }
}

/** job.error → 오류 Alert 본문 (원인 + 해결). */
export function jobErrorText(job: Pick<RecordingJob, "error"> | null): string {
  if (!job?.error || job.error === "interrupted") {
    return "작업이 중단되었습니다. 서버가 재시작된 것 같습니다. 다시 실행을 누르세요.";
  }
  return `${job.error} 원인을 확인한 뒤 다시 실행을 누르세요.`;
}

/** 실패한 청크 번호 안내 ("3, 5번 부분"). */
export function failedChunksText(chunks: readonly number[] | undefined): string | null {
  if (!chunks || chunks.length === 0) return null;
  return `${chunks.join(", ")}번 부분은 고칠 곳 찾기에 실패했습니다.`;
}

/** 오류 상태에서 "같은 종류" 재실행이 화자분리인가 (kind 없으면 화자분리 전이면 true). */
export function errorIsDiarize(job: Pick<RecordingJob, "kind"> | null, diarized: boolean): boolean {
  if (job?.kind) return job.kind === "diarize";
  return !diarized;
}
