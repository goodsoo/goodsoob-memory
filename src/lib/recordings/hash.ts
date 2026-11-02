// `#recording-{base}` 딥링크 (녹음 탭에서 그 녹음 선택). base 는 한글·공백이 들어갈 수
// 있어 encodeURIComponent 로 싣는다. 메모 음성 기록 탭의 배지·섹션 헤딩 링크도 이걸 쓴다.
const PREFIX = "#recording-";

export function recordingHash(base: string): string {
  return `${PREFIX}${encodeURIComponent(base)}`;
}

/** hash 가 `#recording-…` 면 base, 아니면 null. */
export function parseRecordingHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  const raw = hash.slice(PREFIX.length);
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw || null;
  }
}
