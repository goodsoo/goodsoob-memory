import { Keyboard, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button, Dropdown } from "@goodsoob/ds";
import type { RecordingPlayer } from "../../hooks/useAudioPlayback";
import { RATES, formatPlayTime } from "../../lib/recordings/playback";
import { Text } from "../common/Text";

type Props = {
  player: RecordingPlayer;
  /** false 면 (그리고 hasActive 면) "현재 위치로" 버튼이 나옵니다. */
  following: boolean;
  /** 돌아갈 활성 문단이 있는지. 재생 전에는 false 라 버튼을 숨깁니다. */
  hasActive?: boolean;
  onResumeFollow: () => void;
  onOpenHelp: () => void;
};

const ERROR_TEXT: Record<"syncPending" | "missing" | "failed", string> = {
  syncPending: "녹음 파일을 아직 iCloud 에서 받는 중입니다. 잠시 후 다시 시도하세요.",
  missing: "녹음 파일이 없습니다. 파일이 옮겨졌거나 삭제됐는지 확인하세요.",
  failed: "녹음을 재생하지 못했습니다. 앱 서버가 켜져 있는지 확인하고 다시 시도하세요.",
};

const barStyle = {
  position: "sticky",
  bottom: 0,
  background: "var(--surface)",
  color: "var(--text)",
} as const;

function rateLabel(r: number): string {
  return `${r}배`;
}

// 재생 막대 — 숨긴 <audio> 도 여기서 렌더한다. 위치 막대는 DS 에 Slider 가 없어 native range.
export function PlaybackBar({ player, following, hasActive = true, onResumeFollow, onOpenHelp }: Props) {
  const { state } = player;

  if (state !== "ready") {
    return (
      <div className="flex shrink-0 items-center gap-3 px-4 py-2" style={barStyle} data-testid="playback-bar">
        <Text variant="caption" color="muted" className="min-w-0 flex-1">
          {ERROR_TEXT[state]}
        </Text>
        {state !== "missing" && (
          <Button size="sm" disabled={player.retrying} onClick={() => player.retry()}>
            다시 시도
          </Button>
        )}
      </div>
    );
  }

  const max = player.durationSec > 0 ? player.durationSec : 0;

  return (
    <div className="flex shrink-0 items-center gap-2 px-4 py-2" style={barStyle} data-testid="playback-bar">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={player.audioRef} {...player.audioProps} hidden />
      <Button
        variant="ghost"
        iconOnly
        title="5초 뒤로"
        aria-label="5초 뒤로"
        onClick={() => player.skip(-5)}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        iconOnly
        title={player.playing ? "일시정지" : "재생"}
        aria-label={player.playing ? "일시정지" : "재생"}
        onClick={() => player.toggle()}
      >
        {player.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        iconOnly
        title="5초 앞으로"
        aria-label="5초 앞으로"
        onClick={() => player.skip(5)}
      >
        <RotateCw className="h-4 w-4" />
      </Button>
      <Text
        variant="caption"
        color="muted"
        className="shrink-0 whitespace-nowrap"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatPlayTime(player.currentSec)} / {formatPlayTime(player.durationSec)}
      </Text>
      <input
        type="range"
        aria-label="재생 위치"
        className="min-w-0 flex-1"
        style={{ accentColor: "var(--btn-primary)" }}
        min={0}
        max={max}
        step={0.1}
        value={Math.min(player.currentSec, max)}
        disabled={max === 0}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      <Dropdown
        trigger={
          <Button variant="ghost" size="sm" title="재생 속도" aria-label="재생 속도">
            {rateLabel(player.rate)}
          </Button>
        }
        items={RATES.map((r) => ({
          key: String(r),
          label: rateLabel(r),
          selected: r === player.rate,
          onSelect: () => player.setRate(r),
        }))}
      />
      {!following && hasActive && (
        <Button variant="ghost" size="sm" onClick={onResumeFollow}>
          현재 위치로
        </Button>
      )}
      <Button variant="ghost" iconOnly title="단축키" aria-label="단축키" onClick={onOpenHelp}>
        <Keyboard className="h-4 w-4" />
      </Button>
    </div>
  );
}
