// 녹음 base 이름(`_audio/<base>.m4a` 의 확장자 뺀 부분) 파싱. 순수 모듈 — 서버·클라 공용.
//
// 지원 패턴 (실제 ~/brain/_audio 이름 기준):
//   YYYYMMDD-HHmm / YYYYMMDD-HHmmss        메뉴바 녹음기·음성 메모 import (label = base 전체)
//   위 + `-vm`/`-vm2` 충돌 접미사
//   YYYYMMDD-HHmm_주제_사람                 label = `_` 뒤 전부
//   YYYYMMDD_주제_사람                      시각 없음
//   그 외(`New-Recording-3` 등)             label = 이름 전체, date/time 없음

export interface ParsedBase {
  base: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  label: string;
}

const TS_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?(-vm\d*)?(?:_(.+))?$/;
const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:_(.+))?$/;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function parseBase(base: string): ParsedBase {
  const ts = TS_RE.exec(base);
  if (ts) {
    const [, y, mo, d, hh, mm, , , rest] = ts;
    if (validDate(+y, +mo, +d) && +hh < 24 && +mm < 60) {
      return {
        base,
        date: `${y}-${mo}-${d}`,
        time: `${hh}:${mm}`,
        label: rest ?? base,
      };
    }
  }
  const dt = DATE_RE.exec(base);
  if (dt) {
    const [, y, mo, d, rest] = dt;
    if (validDate(+y, +mo, +d)) {
      return { base, date: `${y}-${mo}-${d}`, label: rest ?? base };
    }
  }
  return { base, label: base };
}

// 오름차순 정렬 키(문자열 비교). 날짜 미상은 맨 뒤(`~`), 같은 날 시각 미상은 그날 맨 뒤.
export function baseSortKey(base: string): string {
  const p = parseBase(base);
  if (!p.date) return `~ ${base}`;
  return `${p.date} ${p.time ?? "99:99"} ${base}`;
}

export function compareBases(a: string, b: string): number {
  const ka = baseSortKey(a);
  const kb = baseSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// 섹션 헤딩 `## {timeLabel} · {base}` 용 라벨. 시각 -> "HH:mm", 날짜만 -> "YYYY.MM.DD", 없으면 "".
export function baseTimeLabel(base: string): string {
  const p = parseBase(base);
  if (p.time) return p.time;
  if (p.date) return p.date.replace(/-/g, ".");
  return "";
}

// frontmatter `audio:` 값 정규화. YAML 이 숫자만인 base 를 number 로 읽거나
// 단일 스칼라로 쓴 경우를 흡수. 빈 값·객체는 버림.
export function normalizeAudioList(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
      const s = String(v).trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}
