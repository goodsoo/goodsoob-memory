import { useState } from "react";
import { Alert } from "@goodsoob/ds";
import { Button } from "../common/Button";
import { audioUrl } from "../../api/recordings";

type Props = {
  base: string;
  /** 목록 응답이 dataless 라고 알려준 경우 — 재생 대신 동기화 안내부터. */
  syncPending: boolean;
};

type LoadError = "syncPending" | "missing" | "failed" | null;

// 녹음 재생 — `<audio>` 가 /api/audio 를 직접 연다 (Range seek 는 서버 Bun.file 이 처리).
// `<audio>` 의 error 이벤트는 HTTP 상태를 안 알려주므로, 실패하면 한 번 더 요청해 503
// (iCloud 동기화 대기) / 404 (파일 없음) 를 구분한다.
export function AudioPlayer({ base, syncPending }: Props) {
  const [error, setError] = useState<LoadError>(syncPending ? "syncPending" : null);
  const [nonce, setNonce] = useState(0);
  const [checking, setChecking] = useState(false);

  async function diagnose() {
    try {
      const res = await fetch(audioUrl(base), { headers: { Range: "bytes=0-0" } });
      if (res.status === 503) setError("syncPending");
      else if (res.status === 404) setError("missing");
      else setError("failed");
    } catch {
      setError("failed");
    }
  }

  async function retry() {
    setChecking(true);
    try {
      // 이 요청이 서버에서 brctl download 를 건다. 200/206 이면 플레이어를 다시 띄운다.
      const res = await fetch(audioUrl(base), { headers: { Range: "bytes=0-0" } });
      if (res.ok) {
        setError(null);
        setNonce((n) => n + 1);
      } else if (res.status === 503) setError("syncPending");
      else if (res.status === 404) setError("missing");
      else setError("failed");
    } catch {
      setError("failed");
    } finally {
      setChecking(false);
    }
  }

  if (error) {
    const msg =
      error === "syncPending"
        ? "녹음 파일이 아직 이 맥으로 동기화되지 않았습니다. 잠시 후 다시 시도하세요."
        : error === "missing"
          ? "녹음 파일이 없습니다. 파일이 옮겨졌거나 삭제됐을 수 있습니다."
          : "녹음을 재생하지 못했습니다. 앱 서버가 켜져 있는지 확인하고 다시 시도하세요.";
    return (
      <Alert
        variant={error === "syncPending" ? "info" : "warn"}
        action={
          error === "missing" ? undefined : (
            <Button size="sm" disabled={checking} onClick={() => void retry()}>
              다시 시도
            </Button>
          )
        }
      >
        {msg}
      </Alert>
    );
  }

  return (
    <audio
      key={nonce}
      controls
      preload="metadata"
      src={audioUrl(base)}
      onError={() => void diagnose()}
      className="w-full"
    />
  );
}
