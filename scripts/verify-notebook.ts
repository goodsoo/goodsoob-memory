#!/usr/bin/env bun
// 노트북 소화물 검증 CLI — /study 스킬이 생성 직후 돌린다 (docs/designs/notebook-tab.md).
//   bun scripts/verify-notebook.ts <노트북 폴더 경로>
// 판정은 src/lib/notebook 을 그대로 쓴다 (탭과 같은 로직). 여기는 파일 IO 만.
// exit 0 = 실패 0, exit 1 = 실패 있음, exit 2 = 사용법/노트북 아님.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkNotebook } from "../src/lib/notebook/check.ts";
import { splitFrontmatter } from "../src/lib/vault/parser.ts";

const arg = process.argv[2];
if (!arg) {
  console.error("사용법: bun scripts/verify-notebook.ts <노트북 폴더 경로>");
  process.exit(2);
}
const dir = resolve(arg);
const readmePath = join(dir, "README.md");
if (!existsSync(readmePath)) {
  console.error(`README.md 가 없습니다: ${readmePath}`);
  process.exit(2);
}
const readme = readFileSync(readmePath, "utf8");
if (splitFrontmatter(readme).frontmatter.type !== "notebook") {
  console.error("README.md frontmatter 에 type: notebook 이 없습니다.");
  process.exit(2);
}

// 노트북 루트를 "" 로 두고 경로는 dir 기준으로 읽는다 — resolveSrc 가 `..` · 절대경로를 이미 거른다.
const report = await checkNotebook("", readme, async (rel) => {
  const p = join(dir, rel);
  try {
    return statSync(p).isFile() ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
});

for (const w of report.warnings) console.log(`경고  ${w.where}  ${w.message}`);
for (const f of report.failures) console.log(`실패  ${f.where}  ${f.message}`);
console.log(
  `\n주장 ${report.claimCount}개 · 퀴즈 ${report.questionCount}문항 · 실패 ${report.failures.length} · 경고 ${report.warnings.length}`,
);
process.exit(report.failures.length > 0 ? 1 : 0);
