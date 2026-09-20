#!/usr/bin/env node
/**
 * ds-guard.mjs — 관리파일 봉인검사
 *
 * consumer 루트(cwd)에서 실행. .ds-managed.json의 지문과 실제 파일을 대조해
 * canonical(@goodsoob/ds)이 관리하는 구간이 손으로 수정됐는지 검사한다.
 *
 * Usage (consumer 루트에서):
 *   node ../goodsoob-design-system/scripts/ds-guard.mjs
 *
 * Exit codes:
 *   0 — 무결 (또는 baseline 없음)
 *   1 — 위반 발견
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBlock, hashContent } from './ds-sentinel.mjs';

const consumerRoot = process.cwd();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const managedPath = path.join(consumerRoot, '.ds-managed.json');
  const managed = readJSON(managedPath);

  if (!managed) {
    console.log('이 앱은 DS 관리 baseline이 없습니다 (아직 sync가 실행되지 않았습니다).');
    console.log('sync를 먼저 실행하세요: node <ds-root>/scripts/sync.mjs <this-consumer>');
    process.exit(0);
  }

  // allowlist (.ds-managed.allow.json) — { "<path>": "<사유>" }
  const allowPath = path.join(consumerRoot, '.ds-managed.allow.json');
  const allow = readJSON(allowPath) ?? {};

  const violations = [];
  let checkedCount = 0;

  for (const [filePath, entry] of Object.entries(managed.files ?? {})) {
    // allowlist 처리 — 문자열: 파일 전체 허용 / 객체 {blocks:{name:사유}}: 블록 단위 허용
    const allowEntry = allow[filePath];
    if (typeof allowEntry === 'string') {
      console.warn(`⚠ promote 대기 (파일 전체): ${filePath} (${allowEntry})`);
      continue;
    }
    const allowedBlocks =
      allowEntry && typeof allowEntry === 'object' ? (allowEntry.blocks ?? {}) : {};

    const absPath = path.join(consumerRoot, filePath);
    const content = readFileSafe(absPath);

    if (entry.type === 'copy') {
      checkedCount++;
      if (content === null) {
        violations.push({ file: filePath, detail: '파일 없음' });
        continue;
      }
      const actual = hashContent(content);
      if (actual !== entry.sha256) {
        violations.push({ file: filePath, detail: '파일 내용이 canonical과 다릅니다 (copy 전체 불일치)' });
      }

    } else if (entry.type === 'blocks') {
      if (content === null) {
        for (const blockName of Object.keys(entry.blocks ?? {})) {
          checkedCount++;
          violations.push({ file: filePath, block: blockName, detail: '파일 없음' });
        }
        continue;
      }

      // 블록별 검사 — comment 타입을 파일 확장자에서 유추
      const ext = path.extname(filePath).slice(1); // 'css' | 'js' | 'md'
      const commentType = ['css', 'js', 'md'].includes(ext) ? ext : 'css';

      for (const [blockName, expectedHash] of Object.entries(entry.blocks ?? {})) {
        if (allowedBlocks[blockName] !== undefined) {
          console.warn(`⚠ promote 대기 (블록): ${filePath} [${blockName}] (${allowedBlocks[blockName]})`);
          continue;
        }
        checkedCount++;
        const blockStr = extractBlock(content, blockName, commentType);
        if (blockStr === null) {
          violations.push({ file: filePath, block: blockName, detail: `sentinel 블록 "${blockName}"을 찾을 수 없습니다` });
          continue;
        }
        const actual = hashContent(blockStr);
        if (actual !== expectedHash) {
          violations.push({ file: filePath, block: blockName, detail: `블록 "${blockName}" 내용이 canonical과 다릅니다` });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`✓ 관리파일 무결 (${checkedCount}개 확인)`);
    process.exit(0);
  }

  // 위반 보고
  console.error(`\n관리파일 봉인 위반 — ${violations.length}건:\n`);
  for (const v of violations) {
    const loc = v.block ? `${v.file} [block: ${v.block}]` : v.file;
    console.error(`  ✗ ${loc}`);
    console.error(`    ${v.detail}`);
  }

  console.error(`
──────────────────────────────────────────────────────────────────
이 파일들은 canonical(@goodsoob/ds)이 관리하는 파일입니다.
직접 수정하지 마세요.

  • DS에 반영이 필요한 변경이면 → /ds-fix 로 제보하세요.
  • consumer가 역류시켜야 할 변경이면 → ds-sync promote 를 사용하세요.
  • 정당한 로컬 수정이라면 → .ds-managed.allow.json 에 경로와 사유를 등록하세요.
    파일 전체: { "public/dev-inspector.js": "사유" }
    블록 단위: { "src/styles/tokens.css": { "blocks": { "color": "타워 전용 오버라이드, 캡틴 승인" } } }
──────────────────────────────────────────────────────────────────`);

  process.exit(1);
}

main();
