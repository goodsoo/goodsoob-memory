#!/usr/bin/env node
/**
 * px-guard — 스케일 밖 하드코딩 px 차단 (재drift 방지)
 *
 * spacing(padding/margin/gap)·radius(border-radius) 프로퍼티에서 canonical 스케일
 * 밖의 px 값을 잡는다. tower 12.5·13.5, radius 10 같은 off-scale 재발 방지가 목적.
 * growth 가 package.json 없는 정적앱이라 stylelint 프레임워크 대신 zero-dep 로.
 *
 * 사용 (CSS):
 *   node scripts/px-guard.mjs <file.css> [file2.css ...]
 *   node scripts/px-guard.mjs --check ...              # 위반 시 exit 1 (CI/pre-commit)
 *   node scripts/px-guard.mjs --update-baseline ...    # 현재 위반을 베이스라인에 기록(수용)
 *   node scripts/px-guard.mjs --check --baseline ...   # 베이스라인 밖 '새' 위반만 실패
 *
 * 사용 (TSX/JSX — 보고 전용, 베이스라인 없음):
 *   node scripts/px-guard.mjs --tsx <file.tsx> [file2.tsx ...]
 *   node scripts/px-guard.mjs --tsx --check ...        # 위반 시 exit 1
 *
 * 베이스라인: 레거시 코드(예: growth 조밀 spacing 145건)를 전부 스냅하지 않고 '현재 상태'를
 *   수용하되, 앞으로 추가되는 off-scale 만 막는다. 파일별 `<file>.px-guard-baseline.json`.
 *   재drift 방지가 목적이지 기존 일괄수정이 아님.
 *
 * 예외: 해당 라인에 `px-guard-ignore` 주석이 있으면 그 라인은 건너뜀
 *       (의도적 특수값 — 말풍선 비대칭 radius, 스크롤바 thumb 등).
 *
 * var()·calc()·%·기타 단위는 검사 대상 아님(토큰 사용 = 정상). width/height/top 등
 * 위치·치수 프로퍼티는 대상 밖(스케일 강제 부적합).
 */
import fs from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────
// canonical 스케일 (systems/work/tokens/scale.css 와 일치 유지)
// ─────────────────────────────────────────────────────────
const SPACING_OK = new Set([0, 4, 6, 8, 12, 16, 20, 24, 32]);
const RADIUS_OK = new Set([0, 6, 8, 16, 9999]);

// TSX 추가 스케일 (on-scale = 위반 아님)
// fontSize: --fs-* 토큰 대응값 (10/11/12/13/14/15/17/19/22/27/30/34/44)
// rounded: 6/8/16 (RADIUS_OK 공용)
const FONT_OK = new Set([10, 11, 12, 13, 14, 15, 17, 19, 22, 27, 30, 34, 44]);

const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;
const RADIUS_PROP = /^border(-(top|bottom)-(left|right))?-radius$/;

function pxValues(value) {
  // var()/calc() 안은 토큰/연산이라 스킵. 순수 px 리터럴만.
  if (/var\(|calc\(/.test(value)) return [];
  const out = [];
  for (const m of value.matchAll(/(-?\d*\.?\d+)px\b/g)) out.push(parseFloat(m[1]));
  return out;
}

// 라인 이동에 안정적인 시그니처 (라인번호 대신 prop|절대px|정규화된 선언텍스트)
function sig(v) {
  return `${v.prop}|${Math.abs(v.px)}|${v.text.replace(/\s+/g, ' ').trim()}`;
}
const baselineFile = (file) => `${file}.px-guard-baseline.json`;

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const violations = [];
  // 아주 단순한 선언 추출: `prop: value;` (한 줄에 여러 선언도 처리)
  lines.forEach((line, i) => {
    if (/px-guard-ignore/.test(line)) return;
    // 주석 제거(대략)
    const code = line.replace(/\/\*.*?\*\//g, '');
    for (const decl of code.split(';')) {
      const m = decl.match(/([a-z-]+)\s*:\s*(.+)$/i);
      if (!m) continue;
      const prop = m[1].trim().toLowerCase();
      const val = m[2].trim();
      const isSpacing = SPACING_PROP.test(prop);
      const isRadius = RADIUS_PROP.test(prop);
      if (!isSpacing && !isRadius) continue;
      const ok = isSpacing ? SPACING_OK : RADIUS_OK;
      for (const px of pxValues(val)) {
        if (!ok.has(Math.abs(px))) {
          violations.push({ line: i + 1, prop, px, text: decl.trim() });
        }
      }
    }
  });
  return violations;
}

// ─────────────────────────────────────────────────────────
// TSX / Tailwind 스캐너 (--tsx 플래그)
// ─────────────────────────────────────────────────────────

/**
 * 숫자 또는 '18px' / "18px" 문자열에서 px 값 추출.
 * calc() / var() / 0 / 1px(border) / 100%·rem·em 는 제외.
 *
 * @param {string} raw   - 따옴표 없는 원시 값 (e.g. "16", "'16px'", "'8px 2px'")
 * @returns {number[]}
 */
function tsxPxValues(raw) {
  // var()/calc() → 토큰/연산, 스킵
  if (/var\(|calc\(/.test(raw)) return [];
  // % / rem / em 단위 → 스킵 (px 아님)
  if (/%|rem\b|em\b/.test(raw) && !/px/.test(raw)) return [];

  const out = [];
  // 문자열 리터럴: '18px' or "8px 4px" — px 단위 명시된 것
  for (const m of raw.matchAll(/(-?\d*\.?\d+)px/g)) {
    const v = parseFloat(m[1]);
    if (v !== 0) out.push(v); // 0px 는 무해
  }
  // 숫자 리터럴(따옴표 없이 숫자만, px 단위 없음) — `fontSize: 13` 같은 케이스
  // 따옴표·px·%·rem·em·.·/ 없이 순수 정수인지 확인
  if (!out.length && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
    const v = parseFloat(raw.trim());
    if (v !== 0) out.push(v);
  }
  return out;
}

/**
 * TSX inline-style 속성 → off-scale 위반 검출
 *
 * 대상 prop 분류:
 *   spacing : padding* / margin* / gap / rowGap / columnGap
 *   radius  : borderRadius*
 *   fontSize: fontSize
 *   icon    : (width/height) — fontSize 스케일로 검증 (icon 크기)
 *             단, 일반 레이아웃 width/height 는 너무 false-positive 가 많아 제외
 *   ctl-h   : minHeight / maxHeight 는 제외 (레이아웃 자유값)
 *
 * 'px-guard-ignore' 주석 줄은 건너뜀.
 */
const TSX_SPACING_PROP = /^(padding(Top|Right|Bottom|Left|Block|Inline|Start|End)?|margin(Top|Right|Bottom|Left|Block|Inline|Start|End)?|gap|rowGap|columnGap)$/;
const TSX_RADIUS_PROP  = /^borderRadius(TopLeft|TopRight|BottomLeft|BottomRight|StartStart|StartEnd|EndStart|EndEnd)?$/;
const TSX_FONT_PROP    = /^fontSize$/;

function checkTsxFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const violations = [];

  // ── 1. inline-style 속성 스캔 ──────────────────────────
  // 패턴: `propName: value` within style={{ ... }} objects
  // 간단 휴리스틱: camelCase prop 뒤에 콜론 + 숫자리터럴 or 따옴표 안 px값
  const INLINE_STYLE_RE = /\b([a-zA-Z]+)\s*:\s*(['"]?)(-?\d*\.?\d+(?:px)?(?:\s+-?\d*\.?\d+(?:px)?)*)\2/g;

  lines.forEach((line, i) => {
    if (/px-guard-ignore/.test(line)) return;

    // ── inline style 검사 ──
    let m;
    INLINE_STYLE_RE.lastIndex = 0;
    while ((m = INLINE_STYLE_RE.exec(line)) !== null) {
      const prop = m[1];
      const raw  = m[3]; // 따옴표 안 값

      const isSpacing = TSX_SPACING_PROP.test(prop);
      const isRadius  = TSX_RADIUS_PROP.test(prop);
      const isFont    = TSX_FONT_PROP.test(prop);
      if (!isSpacing && !isRadius && !isFont) continue;

      const scale = isFont ? FONT_OK : isRadius ? RADIUS_OK : SPACING_OK;

      for (const px of tsxPxValues(raw)) {
        if (!scale.has(Math.abs(px))) {
          violations.push({
            kind: 'inline',
            line: i + 1,
            prop,
            px,
            text: `${prop}: ${m[2]}${raw}${m[2]}`,
          });
        }
      }
    }

    // ── 2. Tailwind arbitrary value 스캔 ──────────────────
    // 패턴: `utility-[Npx]` or `utility-[N.Nrem]` in className strings
    // 스캔 대상 prefix:
    //   spacing: p / px / py / pt / pr / pb / pl / m / mx / my / mt / mr / mb / ml / gap / gap-x / gap-y
    //   radius:  rounded / rounded-t / rounded-b / rounded-l / rounded-r / rounded-tl 등
    //   font:    text-[Npx]
    //   layout:  h-[Npx] / w-[Npx] / min-w-[Npx] / max-w-[Npx] / min-h-[Npx] / max-h-[Npx]
    // rem 는 스케일 검증 적용 (1rem=16px 으로 환산)
    const TW_RE = /\b((?:p[xytblrs]?|m[xytblrs]?|gap(?:-[xy])?|rounded(?:-[a-z]{1,3})?|text|min-w|max-w|min-h|max-h|[hwz]|inset(?:-[xytblrs]?)?|top|left|right|bottom))-\[(-?\d*\.?\d+)(px|rem)\]/g;

    TW_RE.lastIndex = 0;
    while ((m = TW_RE.exec(line)) !== null) {
      const prefix = m[1];
      let val      = parseFloat(m[2]);
      const unit   = m[3];

      // rem → px 환산 (1rem = 16px 기준)
      if (unit === 'rem') val = Math.round(val * 16 * 100) / 100;

      // 0 / 1px (border) 허용
      if (val === 0 || (unit === 'px' && parseFloat(m[2]) === 1)) continue;

      // prefix → 스케일 분류
      let scale;
      if (/^rounded/.test(prefix))                         scale = RADIUS_OK;
      else if (/^text$/.test(prefix))                      scale = FONT_OK;
      else if (/^[hw]$|^(?:min|max)-[hw]$/.test(prefix))  scale = null; // 레이아웃 치수 = 스케일 강제 안 함
      else                                                  scale = SPACING_OK;

      if (scale === null) continue; // 레이아웃 width/height 는 false-positive 가 많아 제외

      if (!scale.has(Math.abs(val))) {
        violations.push({
          kind: 'tailwind',
          line: i + 1,
          prop: prefix,
          px: unit === 'rem' ? val : parseFloat(m[2]),
          unit,
          text: `${prefix}-[${m[2]}${unit}]`,
        });
      }
    }
  });

  return violations;
}

/** 재귀로 .tsx / .jsx 파일 목록 수집 */
function collectTsxFiles(dir) {
  const result = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        result.push(...collectTsxFiles(path.join(dir, entry.name)));
      } else if (/\.(tsx|jsx)$/.test(entry.name)) {
        result.push(path.join(dir, entry.name));
      }
    }
  } catch { /* 접근 불가 디렉터리 무시 */ }
  return result;
}

function runTsxScan(rawArgs, check) {
  // rawArgs = --tsx 이후 파일·디렉터리 목록
  const targets = [];
  for (const a of rawArgs) {
    try {
      const stat = fs.statSync(a);
      if (stat.isDirectory()) targets.push(...collectTsxFiles(a));
      else targets.push(a);
    } catch {
      console.error(`  경고: 접근 불가 — ${a}`);
    }
  }

  if (!targets.length) {
    console.error('TSX 스캔 대상 파일/디렉터리가 없습니다.');
    process.exit(1);
  }

  let totalInline = 0;
  let totalTw     = 0;
  const byFile    = [];

  for (const file of targets) {
    const v = checkTsxFile(file);
    if (!v.length) continue;
    byFile.push({ file, all: v });
  }

  // 결과 출력 (같은 file:line:text 는 dedup) + 카운트 집계
  for (const { file, all } of byFile) {
    console.log(`\n  ${file}`);
    const seen = new Set();
    for (const x of all) {
      const tag = x.kind === 'tailwind' ? '[TW]' : '[style]';
      const display = x.unit === 'rem' ? `${x.text}  (≈${x.px}px)` : x.text;
      const key = `${x.line}:${display}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`      ${file}:${x.line}  ${tag}  ${display}`);
      if (x.kind === 'inline') totalInline++; else totalTw++;
    }
  }

  const total = totalInline + totalTw;
  console.log(`\n────────────────────────────────────────`);
  console.log(`TSX off-scale 합계: ${total}건  (inline-style ${totalInline} + Tailwind-arbitrary ${totalTw})`);
  if (total && check) process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const scanTsx = args.includes('--tsx') || args.includes('--scan-tsx');

  // ── TSX 모드 분기 ────────────────────────────────────────
  if (scanTsx) {
    const tsxFlags = new Set(['--tsx', '--scan-tsx', '--check']);
    const tsxTargets = args.filter((a) => !tsxFlags.has(a));
    runTsxScan(tsxTargets, check);
    return;
  }

  // ── 기존 CSS 모드 (변경 없음) ────────────────────────────
  const useBaseline = args.includes('--baseline');
  const updateBaseline = args.includes('--update-baseline');
  const flags = new Set(['--check', '--baseline', '--update-baseline']);
  const files = args.filter((a) => !flags.has(a));
  if (!files.length) {
    console.error('Usage: node scripts/px-guard.mjs [--check] [--baseline|--update-baseline] <file.css> ...');
    process.exit(1);
  }
  let newTotal = 0;
  for (const file of files) {
    const v = checkFile(file);

    if (updateBaseline) {
      const sigs = v.map(sig).sort();
      fs.writeFileSync(baselineFile(file), JSON.stringify(sigs, null, 2) + '\n');
      console.log(`  = ${file} — 베이스라인 기록 ${sigs.length}건 → ${baselineFile(file)}`);
      continue;
    }

    let base = new Set();
    if (useBaseline) {
      try { base = new Set(JSON.parse(fs.readFileSync(baselineFile(file), 'utf8'))); } catch { /* 없으면 빈 */ }
    }
    const fresh = v.filter((x) => !base.has(sig(x)));

    if (!fresh.length) {
      console.log(`  ✓ ${file} — 새 off-scale px 없음${useBaseline ? ` (베이스라인 ${base.size}건 수용)` : ''}`);
      continue;
    }
    newTotal += fresh.length;
    console.log(`  ✗ ${file} — 새 위반 ${fresh.length}건${useBaseline ? ` (베이스라인 ${base.size}건 외)` : ''}`);
    for (const x of fresh) {
      console.log(`      ${file}:${x.line}  ${x.prop}: ${x.px}px  (스케일 밖) — ${x.text}`);
    }
  }
  if (updateBaseline) { console.log('\n베이스라인 갱신 완료.'); return; }
  if (newTotal) {
    console.log(`\n새 위반 ${newTotal}건. 스케일(spacing 4/6/8/12/16/20/24/32 · radius 6/8/16/full) 밖 px.`);
    console.log('의도면 /* px-guard-ignore */ 또는 --update-baseline 으로 수용.');
    if (check) process.exit(1);
  } else {
    console.log('\nOK — 새 off-scale px 없음.');
  }
}

main();
