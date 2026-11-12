// 인용 버튼 — 브리핑 · 퀴즈 공용. 대조 결과에 따라 라벨 · 톤이 바뀌고, 누르면 원문 열람을 연다.
// (react-markdown 각주 앵커 대신 쓰는 이유는 NotebookTab.tsx 머리 주석.)

import { Button } from "@goodsoob/ds";
import type { CiteStatus } from "../../lib/notebook/check";

/** 원문 열람 대상. status 가 ok 면 하이라이트, 아니면 이유를 띄운다. */
export interface OpenCite {
  src: string;
  quote: string;
  status: CiteStatus | undefined;
}

const baseName = (src: string) => (src.split("/").pop() ?? src).replace(/\.md$/i, "");

/** 칩 라벨은 짧게 — `sources/03-xxx.md` → "자료 03". 번호 없는 파일은 파일명(길면 말줄임). 전체 경로 · 발췌는 툴팁. */
export function citeLabel(src: string): string {
  const name = baseName(src);
  const num = name.match(/^(\d+)[-_ ]/)?.[1];
  if (num) return `자료 ${num}`;
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

export function CiteButton({
  src,
  quote,
  status,
  onOpen,
}: {
  src: string;
  quote: string;
  status: CiteStatus | undefined;
  onOpen: (c: OpenCite) => void;
}) {
  const ok = status?.status === "ok";
  const short = citeLabel(src);
  const label = ok ? short : status?.status === "mismatch" ? `원문에서 못 찾음 · ${short}` : `원문 없음 · ${short}`;
  return (
    <Button
      size="sm"
      variant="secondary"
      tone={ok ? undefined : "down"}
      title={`${src} · “${quote}”`}
      onClick={() => onOpen({ src, quote, status })}
    >
      {label}
    </Button>
  );
}
