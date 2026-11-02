import { useEffect, useMemo, useState } from "react";
import { Play, X } from "lucide-react";

import { Text } from "../common/Text";

// 음성 기록 보기 모드 — 읽기 전용 평문(pre-wrap, 마크다운 렌더 X) + 참석자별 색상 칩
// + mm:ss 타임스탬프(회색 박스) 하이라이트. textarea 안에선 inline 색을 못 넣어 div 로
// 렌더 → 자연히 편집 불가. STT 줄바꿈/들여쓰기 보존.
// 녹음 섹션 헤딩(`## {시각} · {base}`, base 는 메모 audio: 값과 정확 일치) 옆엔 ▶ 플레이어.
const SPEAKER_COLOR_COUNT = 10; // index.css 의 --speaker-0..9 와 일치.

type Seg = { text: string; kind: "plain" | "name" | "time" };

interface Chunk {
  kind: "text" | "heading";
  text: string; // heading 이면 prefix(`## 시각 · `) 만, base 는 별도
  base?: string;
}

const SEP = " · ";

// 헤딩 줄이면 일치하는 base (긴 것 우선), 아니면 null. 정규식 안 씀.
export function matchHeadingBase(line: string, audio: readonly string[]): string | null {
  if (!line.startsWith("## ")) return null;
  let best: string | null = null;
  for (const b of audio) {
    if (!b) continue;
    const tail = SEP + b;
    if (
      line.endsWith(tail) &&
      line.length >= 3 + tail.length &&
      (best === null || b.length > best.length)
    ) {
      best = b;
    }
  }
  return best;
}

function splitChunks(transcript: string, audio: readonly string[]): Chunk[] {
  if (audio.length === 0) return [{ kind: "text", text: transcript }];
  const out: Chunk[] = [];
  let buf = "";
  let pos = 0;
  while (pos < transcript.length) {
    const nl = transcript.indexOf("\n", pos);
    const lineEnd = nl === -1 ? transcript.length : nl;
    const raw = transcript.slice(pos, lineEnd);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const base = matchHeadingBase(line, audio);
    if (base) {
      if (buf) out.push({ kind: "text", text: buf });
      buf = "";
      out.push({
        kind: "heading",
        text: line.slice(0, line.length - base.length),
        base,
      });
      // 헤딩 줄 개행은 text 로 이어붙여 pre-wrap 줄바꿈 유지.
      buf = nl === -1 ? "" : transcript.slice(lineEnd, nl + 1);
    } else {
      buf += transcript.slice(pos, nl === -1 ? transcript.length : nl + 1);
    }
    pos = nl === -1 ? transcript.length : nl + 1;
  }
  if (buf) out.push({ kind: "text", text: buf });
  return out;
}

type AudioState = "loading" | "ok" | "missing" | "syncPending" | "error";

export function audioUrl(base: string): string {
  return `/api/audio?base=${encodeURIComponent(base)}`;
}

function AudioSlot({ base, onClose }: { base: string; onClose: () => void }) {
  const [state, setState] = useState<AudioState>("loading");

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
        <audio controls autoPlay preload="metadata" src={audioUrl(base)} className="h-8 flex-1" />
      ) : msg ? (
        <Text variant="caption" color="muted">
          {msg}
        </Text>
      ) : (
        <Text variant="caption" color="muted">
          불러오는 중
        </Text>
      )}
      <button
        type="button"
        aria-label="플레이어 닫기"
        title="닫기"
        onClick={onClose}
        className="inline-flex items-center justify-center rounded p-1"
        style={{ color: "var(--ink-muted, var(--ink))" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function TranscriptView({
  transcript,
  attendees,
  audio = [],
}: {
  transcript: string;
  attendees: string;
  /** 이 메모 frontmatter `audio:` base 목록 — 헤딩 ▶ 판정 기준. */
  audio?: readonly string[];
}) {
  // 한 번에 하나만 재생 — 열린 섹션 base.
  const [openBase, setOpenBase] = useState<string | null>(null);

  // 참석자 문자열(", " join) → 적힌 순서 유지 unique 이름 배열. 1글자 이름은 오버매치
  // (전부 하이라이트) 회피로 제외. 색은 이 순서대로 i%N 배정 → 한 회의 안 색 안 겹침.
  const orderedNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of attendees.split(",")) {
      const n = raw.trim();
      if (n.length >= 2 && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [attendees]);

  // 이름 → speaker 색 인덱스 (적힌 순서 기준, 매칭 정렬과 무관).
  const colorOf = useMemo(() => {
    const m = new Map<string, number>();
    orderedNames.forEach((n, i) => m.set(n, i % SPEAKER_COLOR_COUNT));
    return m;
  }, [orderedNames]);

  // 참석자 이름 + mm:ss / h:mm:ss 타임스탬프를 한 토크나이저로 분리. named group 으로
  // 어느 종류가 매칭됐는지 판별. 둘 다 없으면 통짜 plain.
  const tokenize = useMemo<(text: string) => Seg[]>(() => {
    const patterns: string[] = [];
    if (orderedNames.length > 0) {
      // 매칭은 긴 이름 우선(부분 매칭 방지) — 색 배정 순서와 무관하므로 정렬 복사본.
      const escaped = [...orderedNames]
        .sort((a, b) => b.length - a.length)
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      patterns.push(`(?<name>${escaped.join("|")})`);
    }
    // STT 시간 마커 — 1:23 / 01:23 / 1:23:45. 단어 경계로 12.3 같은 숫자 오매칭 회피.
    patterns.push(`(?<time>\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b)`);
    const source = patterns.join("|");
    return (text: string) => {
      if (text.length === 0) return [];
      const re = new RegExp(source, "g");
      const out: Seg[] = [];
      let last = 0;
      for (const m of text.matchAll(re)) {
        const idx = m.index ?? 0;
        if (idx > last) out.push({ text: text.slice(last, idx), kind: "plain" });
        out.push({ text: m[0], kind: m.groups?.name ? "name" : "time" });
        last = idx + m[0].length;
      }
      if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
      return out;
    };
  }, [orderedNames]);

  const chunks = useMemo(() => splitChunks(transcript, audio), [transcript, audio]);

  if (transcript.trim() === "") {
    return (
      <div style={{ minHeight: "60vh" }}>
        <Text variant="body" color="muted" as="p">
          음성 기록이 없습니다. 편집 모드에서 입력하거나 파일을 업로드하세요.
        </Text>
      </div>
    );
  }

  const renderSegs = (text: string, keyPrefix: string) =>
    tokenize(text).map((seg, i) => {
      const key = `${keyPrefix}-${i}`;
      if (seg.kind === "name") {
        const ci = colorOf.get(seg.text) ?? 0;
        return (
          <span
            key={key}
            className="rounded px-1"
            style={{
              backgroundColor: `var(--speaker-${ci}-bg)`,
              color: `var(--speaker-${ci}-text)`,
            }}
          >
            {seg.text}
          </span>
        );
      }
      if (seg.kind === "time") {
        // 인라인 코드 칩과 동일 레시피 (MarkdownView) — surface-hover + primary.
        // surface-active 는 한 단계 진한 active/선택 상태색이라 정적 칩엔 무거움.
        return (
          <span
            key={key}
            className="rounded px-1 py-0.5 font-mono"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--ink)",
            }}
          >
            {seg.text}
          </span>
        );
      }
      return <span key={key}>{seg.text}</span>;
    });

  return (
    <div
      className="text-base leading-relaxed"
      style={{
        minHeight: "60vh",
        color: "var(--ink)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        // 보기 모드 음성 기록도 외부 복사 주 경로 — body { user-select: none } 를
        // override 해 드래그 선택 허용 (.markdown-view 와 동일 정책).
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {chunks.map((c, ci) => {
        if (c.kind === "text") return renderSegs(c.text, `t${ci}`);
        const base = c.base as string;
        const open = openBase === base;
        return (
          <span key={`h${ci}`}>
            <span className="font-semibold">
              {c.text}
              <a
                href={`#recording-${encodeURIComponent(base)}`}
                style={{ color: "var(--accent)", textDecoration: "underline" }}
                title="녹음 탭에서 열기"
              >
                {base}
              </a>
            </span>
            <button
              type="button"
              aria-label={`${base} 녹음 재생`}
              aria-pressed={open}
              title="이 구간 녹음 재생"
              onClick={() => setOpenBase(open ? null : base)}
              className="ml-2 inline-flex items-center justify-center rounded align-middle"
              style={{
                width: "1.5rem",
                height: "1.5rem",
                backgroundColor: open ? "var(--surface-2)" : "transparent",
                color: "var(--ink)",
                border: "1px solid var(--line)",
              }}
            >
              <Play size={12} />
            </button>
            {open ? <AudioSlot base={base} onClose={() => setOpenBase(null)} /> : null}
          </span>
        );
      })}
    </div>
  );
}
