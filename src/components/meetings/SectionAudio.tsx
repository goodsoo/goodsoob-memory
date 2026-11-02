import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@goodsoob/ds";

import { Text } from "../common/Text";
import { recordingHash } from "../../lib/recordings/hash";

// 메모 음성 기록의 녹음 섹션 헤딩(`## {시각} · {base}`) 공용 조각 — TranscriptView(평문 보기)와
// TranscriptTurns(턴 화면)가 같이 쓴다. base 링크(녹음 탭) + ▶ 토글 + 인라인 플레이어.

type AudioState = "loading" | "ok" | "missing" | "syncPending" | "error";

function audioUrl(base: string): string {
  return `/api/audio?base=${encodeURIComponent(base)}`;
}

/** 시각 클릭으로 들어온 seek 요청. nonce 로 같은 초 재클릭도 다시 적용. */
export interface SeekRequest {
  sec: number;
  nonce: number;
}

export function AudioSlot({
  base,
  onClose,
  seek,
}: {
  base: string;
  onClose: () => void;
  seek?: SeekRequest | null;
}) {
  const [state, setState] = useState<AudioState>("loading");
  const audioRef = useRef<HTMLAudioElement>(null);
  // metadata 로드 전 seek 는 보류했다가 loadedmetadata 에서 적용.
  const pendingSeek = useRef<number | null>(seek ? seek.sec : null);

  // 재생 가능 여부를 Range 0-0 요청으로 먼저 확인 (404 / 503 syncPending 구분).
  useEffect(() => {
    let alive = true;
    fetch(audioUrl(base), { headers: { Range: "bytes=0-0" } })
      .then((res) => {
        if (!alive) return;
        if (res.status === 404) setState("missing");
        else if (res.status === 503) setState("syncPending");
        else if (res.ok) setState("ok");
        else setState("error");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [base]);

  useEffect(() => {
    if (!seek) return;
    const el = audioRef.current;
    if (el && el.readyState >= 1) {
      el.currentTime = seek.sec;
      void el.play().catch(() => {});
    } else {
      pendingSeek.current = seek.sec;
    }
  }, [seek]);

  const msg =
    state === "missing"
      ? "녹음 파일 없음"
      : state === "syncPending"
        ? "동기화 대기 중입니다. 잠시 후 다시 시도하세요."
        : state === "error"
          ? "녹음을 불러오지 못했습니다. 다시 시도하세요."
          : null;

  return (
    <div
      className="flex items-center gap-2 my-1"
      style={{ whiteSpace: "normal" }}
      data-testid="section-audio"
    >
      {state === "ok" ? (
        <audio
          ref={audioRef}
          controls
          autoPlay
          preload="metadata"
          src={audioUrl(base)}
          className="h-8 flex-1"
          onLoadedMetadata={(e) => {
            const s = pendingSeek.current;
            if (s === null) return;
            pendingSeek.current = null;
            e.currentTarget.currentTime = s;
          }}
        />
      ) : msg ? (
        <Text variant="caption" color="muted">
          {msg}
        </Text>
      ) : (
        <Text variant="caption" color="muted">
          불러오는 중
        </Text>
      )}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="플레이어 닫기"
        title="닫기"
        onClick={onClose}
      >
        <X size={14} />
      </Button>
    </div>
  );
}

/** 헤딩 줄 본체 — prefix(`## 시각 · `) + base 링크 + ▶ 버튼. 플레이어는 호출측이 아래에 둔다. */
export function SectionHeadingLabel({
  prefix,
  base,
  open,
  onToggle,
}: {
  prefix: string;
  base: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <span className="font-semibold">
        {prefix}
        <a
          href={recordingHash(base)}
          style={{ color: "var(--accent)", textDecoration: "underline" }}
          title="녹음 탭에서 열기"
        >
          {base}
        </a>
      </span>
      <Button
        variant="secondary"
        size="sm"
        iconOnly
        pressed={open}
        aria-label={`${base} 녹음 재생`}
        title="이 구간 녹음 재생"
        onClick={onToggle}
        className="ml-2 align-middle"
      >
        <Play size={12} />
      </Button>
    </>
  );
}
