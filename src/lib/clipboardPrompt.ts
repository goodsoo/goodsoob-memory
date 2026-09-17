// Claude 등 외부 AI 에 메모 요약 요청할 프롬프트 생성.

export interface PromptInput {
  title?: string | null;
  date?: string | null;
  time?: string | null;
  attendees?: string | string[] | null;
  content?: string | null;
  transcript?: string | null;
}

function attendeesToString(v: PromptInput["attendees"]): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(", ");
  return v;
}

// 요약 템플릿 — 출력 형식(### 섹션들) + 규칙만 상황별로 바꾼다. 입력 파이프라인
// (메타/메모/음성 기록 합성)은 공통이라, 참석자 없는 강의·음성 기록 없는 작업 로그에도
// 같은 흐름이 빈 섹션 없이 적응한다. 저장은 코드 프리셋 (vault 승격은 보류).
export interface SummaryTemplate {
  id: string; // 'meeting' | 'work' | 'lecture'
  label: string; // 모달 칩 라벨
  description: string; // 칩 선택 시 보여줄 한 줄 소개
  intro: string; // 인트로 1줄 (meeting 만 "다음 메모를", 나머지 "다음 내용을")
  format: string; // 출력 형식 fenced 블록 안의 ### 섹션들
  rule: string; // 규칙 1줄
}

export const SUMMARY_TEMPLATES: SummaryTemplate[] = [
  {
    id: "meeting",
    label: "회의록",
    description: "회의 논의·결정·할 일을 정리합니다.",
    intro: "다음 메모를 정리해주세요.",
    format: `### 논의 사항
- 항목1
- 항목2

### 결정 사항
- 합의/확정된 결정만

### 액션 아이템
- [ ] [담당자] 할 일 — 기한

### 기타
- 본 안건과 무관하지만 알아둘 내용`,
    rule: "규칙: 메모에 있는 정보를 우선하고, 음성 기록(transcript)은 디테일 보조. 충돌 시 메모 우선. 액션 아이템은 할 일로 바로 등록되도록 '- [ ]' 체크박스로 적습니다. 본 안건과 무관하지만 알아둘 내용은 '기타' 에 모읍니다. 빈 섹션은 생략.",
  },
  {
    id: "work",
    label: "작업 요약",
    description: "한 일·결과·다음 할 일로 작업을 회고합니다.",
    intro: "다음 내용을 정리해주세요.",
    format: `### 한 일
- 항목1
- 항목2

### 결과
- 배운 점, 막힌 점

### 다음 할 일
- [ ] 항목1

### 기타
- 본 작업과 무관하지만 알아둘 내용`,
    rule: "규칙: 주어진 내용과 음성 기록을 종합합니다. 다음 할 일은 할 일로 바로 등록되도록 '- [ ]' 체크박스로 적습니다. 본 작업과 무관하지만 알아둘 내용은 '기타' 에 모읍니다. 빈 섹션은 생략.",
  },
  {
    id: "lecture",
    label: "세미나·강의",
    description: "핵심 개념·주요 내용·적용점으로 정리합니다.",
    intro: "다음 내용을 정리해주세요.",
    format: `### 핵심 개념
- 항목1
- 항목2

### 주요 내용
- 항목1

### 적용점
- [ ] 내 일에 어떻게 쓸지

### 기타
- 본 주제와 무관하지만 알아둘 내용`,
    rule: "규칙: 주어진 내용과 음성 기록을 종합합니다. 적용점은 할 일로 바로 등록되도록 '- [ ]' 체크박스로 적습니다. 본 주제와 무관하지만 알아둘 내용은 '기타' 에 모읍니다. 빈 섹션은 생략.",
  },
  {
    id: "general",
    label: "일반 요약",
    description: "내용을 빠짐없이 자세히 정리합니다.",
    intro: "다음 내용을 정리해주세요.",
    format: `### 개요
- 무엇에 관한 내용인지 1~2줄

### 상세 정리
- 내용을 흐름대로 빠짐없이 정리
- 세부 사항·수치·예시·근거를 그대로 보존
- 분량이 많으면 #### 소제목으로 구조화

### 기타
- 본 내용과 무관하지만 알아둘 내용`,
    rule: "규칙: 요점만 추리지 말고 내용 전체를 빠짐없이 자세히 정리합니다. 원문의 세부 사항·수치·예시·근거는 보존하되 중복과 군더더기만 다듬습니다. 주어진 내용과 음성 기록을 종합합니다. 본 내용과 무관하지만 알아둘 내용은 '기타' 에 모읍니다. 빈 섹션은 생략.",
  },
];

export const DEFAULT_SUMMARY_TEMPLATE_ID = "meeting";

function buildPromptHeader(templateId: string): string {
  const tpl =
    SUMMARY_TEMPLATES.find((t) => t.id === templateId) ?? SUMMARY_TEMPLATES[0];
  return `${tpl.intro}

## 출력 형식
\`\`\`
${tpl.format}
\`\`\`

${tpl.rule}`;
}

export function buildClaudePrompt(
  input: PromptInput,
  templateId: string = DEFAULT_SUMMARY_TEMPLATE_ID,
): string {
  const parts: string[] = [buildPromptHeader(templateId)];

  const metaLines: string[] = [];
  if (input.title) metaLines.push(`제목: ${input.title}`);
  if (input.date) metaLines.push(`일시: ${input.date}${input.time ? ` ${input.time}` : ""}`);
  const att = attendeesToString(input.attendees);
  if (att.trim()) metaLines.push(`참석: ${att.trim()}`);
  if (metaLines.length > 0) {
    parts.push("## 메타");
    parts.push(metaLines.join("\n"));
  }

  const content = (input.content ?? "").trim();
  if (content) {
    parts.push("## 메모");
    parts.push(content);
  }

  const transcript = (input.transcript ?? "").trim();
  if (transcript) {
    parts.push("## 음성 기록");
    parts.push(transcript);
  }

  return parts.join("\n\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// V0.7 — PR (portfolio) prompt + response parser (design v2.3, step 8)

function buildPRPromptHeader(categories: string[] | undefined): string {
  // vault union 후보가 있으면 그것을 우선 노출. 매칭 없으면 새 슬러그 제안 가능 (옵시디안 tag).
  // 후보가 비어있으면 (vault 첫 사용) "자유 입력" 안내.
  const candidatesLine = categories && categories.length > 0
    ? `현재 vault 의 카테고리 후보: ${categories.map((c) => `\`${c}\``).join(", ")}. 적절한 게 없으면 새 카테고리 슬러그 제안 가능 (영문/한글 단어 1-2개, 공백·괄호·설명 X).`
    : `현재 vault 에 카테고리가 없습니다. 자유 슬러그 1개 제안 (영문/한글 단어 1-2개, 공백·괄호·설명 X). 예: \`ui_ux\`, \`backend\`, \`infra\`, \`fix\`, \`other\`.`;
  return `다음 PR 정보를 보고 한 줄 임팩트 요약 + 카테고리를 정해주세요.

## 출력 형식
\`\`\`
### 한 줄 임팩트
(한 문장, 비즈니스/사용자 임팩트 중심, 30자 이내. bullet 안 붙임)

### 카테고리
(슬러그 1개만, 한 줄 — 괄호·설명·부연 없이 순수 슬러그만. 예: \`ui_ux\` O / \`ui_ux(디자인시스템)\` X)
\`\`\`

규칙: PR title + body + 변경 파일 수/줄 수를 종합. 코드 변경 사실보다 "그래서 뭐가 좋아졌는지" 우선. 카테고리는 절대 괄호·설명을 붙이지 말 것 — 슬러그 한 단어만.

${candidatesLine}`;
}

export interface PRPromptInput {
  title: string;
  body: string;
  url: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  // 옵션 — vault union 의 현재 카테고리 후보. AI 가 우선 후보로 노출.
  categories?: string[];
}

export function buildPRPrompt(input: PRPromptInput): string {
  const parts: string[] = [buildPRPromptHeader(input.categories)];
  parts.push("## PR 정보");
  parts.push(`제목: ${input.title}`);
  parts.push(`URL: ${input.url}`);
  parts.push(
    `변경: ${input.changedFiles} files, +${input.additions} -${input.deletions}`,
  );
  const trimmed = input.body.trim();
  if (trimmed) {
    parts.push("");
    parts.push("## PR 본문");
    const max = 5000;
    if (trimmed.length > max) {
      parts.push(trimmed.slice(0, max));
      parts.push("\n...(truncated)");
    } else {
      parts.push(trimmed);
    }
  }
  return parts.join("\n\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy card prompt — PR 없이 직접 push 한 repo 에서 git log 보고 portfolio
// 카드 작성하라고 "다른 프로젝트의 Claude" 에게 지시하는 self-contained 프롬프트.
// 한 번 복사해서 그 repo 의 Claude Code 에 붙여넣으면 vault 에 카드들이 생김.
// vaultRoot 는 현재 활성 vault 의 절대 경로 — useVault().vaultRoot 에서 주입.

function legacyCardPromptHeader(vaultRoot: string): string {
  return `# Goodsoob 포트폴리오: Legacy 카드 작성 (PR 없는 repo)

지금 이 repo 의 git log 를 보고 본인 (이메일: zzompang2@gmail.com / GitHub: goodsoo, 옛 username: zzompang2) 의 작업을 PR 단위처럼 그룹핑해서 \`${vaultRoot}/portfolio/\` 폴더에 카드 .md 파일들을 만들어줘. 본인이 평가/회고 자료로 쓰는 옵시디안 vault 야.`;
}

const LEGACY_CARD_PROMPT_BODY = `

## 1. 사전 작업

- \`git remote -v\` 로 owner/repo 확인 (\`origin\` 기준, GitHub Enterprise 면 host 도 메모).
- \`git log --reverse --pretty=format:"%h|%ai|%an|%ae|%s"\` 로 전체 히스토리 확보.
- 작성자 필터: 본인 이메일/이름 커밋만 매칭. 이메일은 \`zzompang2@gmail.com\`, author name 은 \`goodsoo\` 또는 옛 username \`zzompang2\` (rename 전 커밋). 회사 도메인 (\`@angel-robotics.com\` 등) 이메일로 커밋된 작업이 있으면 그것도 본인 거니까 포함. 다른 사람 커밋은 카드 만들지 마.
- vault 폴더 \`portfolio/\` 안에 이미 같은 owner/repo 의 카드가 있는지 확인. 있으면 그 다음 시점부터만 만들고, 기존 카드는 절대 덮어쓰지 마.

## 2. 그룹핑 룰

PR 사이즈를 흉내내: 같은 주제 + 시간 근접 (보통 1-3일 안) + 의미있는 마일스톤 1개 단위. 한 마일스톤당 5-30 커밋이 보통, 너무 작으면 합치고 너무 크면 쪼개.

- 같은 기능/리팩토링/버그픽스 흐름은 한 카드로.
- \`chore\`/\`docs\` 만 있는 일회성 커밋은 인접 feat 카드에 흡수.
- 버전 태깅(V0.x) 이나 "ship" 커밋 메시지가 자연스러운 경계.

각 그룹의 의미를 한 줄로 요약할 수 있어야 1개 카드. 못 하면 더 쪼개거나 합쳐.

## 3. 파일 작성

파일 이름: \`portfolio/{owner}-{repo}-{milestone-slug}.md\` (전부 kebab-case). 예: \`goodsoo-work-v0-7-portfolio.md\`. \`{milestone-slug}\` 는 버전 또는 짧은 영문/숫자 식별자 (한글 X).

각 파일 내용:

\`\`\`markdown
---
type: portfolio-work
github_owner: {owner}
github_repo: {repo}
github_pr_number: 0
github_pr_url: ''
github_state: merged
github_merged_at: {그룹 마지막 커밋의 author date, ISO 8601 UTC, 예 2026-05-18T11:30:23Z}
github_title: '{한 줄 마일스톤 제목, 한국어 OK, 작은따옴표 escape}'
github_changed_files: {그룹 첫커밋~끝커밋 git diff --shortstat 의 files changed}
github_additions: {같은 shortstat 의 insertions}
github_deletions: {같은 shortstat 의 deletions}
project: {projects.md 의 slug, 아래 4번 참고}
included: true
category: {ui_ux | backend | infra | fix | other 중 하나}
impact_summary: '{한 문장, 30자 이내, 비즈니스/사용자 임팩트 중심}'
screenshots: []
synced_at: ''
---

## Description (from GitHub)

## 한 줄 임팩트
{유저가 얻는 가치, 30자 이내 한 문장. frontmatter impact_summary 와 동일 내용}

## 문제 (Why)
{이 작업이 풀려고 했던 불편/관찰 — 2-3줄}

## 변경 요약
- {주요 변경 area 별로 1-2 줄씩, 무엇을/왜 했는지}

## 디자인 결정
- {왜 이 방향으로 했나, 고려한 대안과 trade-off}

## 유저가 얻는 것
- {사용자 입장에서 무엇이 좋아졌나, 1-2 bullet}


## Notes

\`\`\`

주의:
- 파일 마지막에 빈 \`## Notes\` 섹션을 한 번 더 둬 (본인이 외부 에디터로 메모 추가하는 영역, 위 Description 안의 섹션과 별개).
- \`github_pr_number: 0\` 이 legacy 카드 표식. 절대 0 이 아닌 값 쓰지 마.
- \`github_pr_url: ''\` 빈 문자열.
- \`category\` 는 enum 5개 중 하나만, 정확한 spelling (\`ui_ux\` 언더바). 매핑: \`ui_ux\` (시각/인터랙션/레이아웃), \`backend\` (API/데이터/로직), \`infra\` (빌드/CI/패키지), \`fix\` (버그 수정), \`other\` (문서/리팩토링/환경).
- UI/UX 작업이면 Before/After 스크린샷 섹션을 추가해도 됨 — 단 legacy 는 GitHub 호스팅 이미지 URL 이 없으니 본인이 나중에 vault 카드 사이드바 dropzone 으로 _attachments/ 에 추가. 본문엔 \`## Before\` / \`## After\` 헤더만 빈 채로 두거나 생략.
- diff stat 은 \`git diff --shortstat <first-commit>~..<last-commit>\` 한 번에 뽑아서 정확히 옮겨. merge commit 끼면 \`--no-merges\` 추가.

## 4. project 분류

\`portfolio/projects.md\` 를 먼저 읽어. frontmatter 의 \`projects:\` 배열에서 이 repo 의 \`nameWithOwner\` 가 \`repos:\` 에 포함된 항목 찾아 그 \`slug\` 를 카드의 \`project\` 필드에 써.

없으면 \`projects:\` 배열 끝에 새 항목을 추가:

\`\`\`yaml
- slug: {owner-repo kebab-case, "/" → "-"}
  name: {owner}/{repo}
  sort: {기존 max(sort)+1}
  repos:
    - {owner}/{repo}
\`\`\`

그리고 새 slug 를 카드의 \`project\` 에 사용.

## 5. 출력

- 모든 카드 파일 작성 완료한 다음, 어떤 마일스톤 N개를 어떤 파일명으로 만들었는지 list 로 보여줘.
- projects.md 수정 했으면 그것도 알려줘.
- 못 정한 그룹핑/category 가 있으면 임의 결정하지 말고 본인한테 물어봐.
`;

export function buildLegacyCardPrompt(vaultRoot: string | null): string {
  // vault 미설정 (vaultRoot null) → 본인에게 vault picker 띄우라고 안내.
  if (!vaultRoot) {
    return `# Goodsoob 포트폴리오: Legacy 카드 작성

본인의 Goodsoob vault 가 아직 설정되지 않았어. 데스크탑 앱에서 vault 폴더를 먼저 선택한 다음 다시 이 버튼 눌러서 프롬프트 복사해줘.
`;
  }
  return legacyCardPromptHeader(vaultRoot) + LEGACY_CARD_PROMPT_BODY;
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 가이드 프롬프트 — 다른 프로젝트의 Claude Code 에게 "앞으로 이 repo 에서
// PR 만들 땐 이 양식 따라라" 라고 지시. 그 repo 의 CLAUDE.md 에 PR 규칙
// 섹션을 박는 작업까지 시킴 → 다음 세션에도 자동 적용.
//
// 사용자의 goodsoob-work 데스크탑 앱이 본인 PR 들을 자동 수집해서 카드로
// 만드니까, PR body 가 곧 포트폴리오 본문이 됨. UI/UX 가 본인 주력이라
// before/after 스크린샷이 핵심 → 템플릿이 7섹션 강제.

const PR_GUIDE_PROMPT = `# Goodsoob 포트폴리오 호환: PR 작성 가이드

본인이 운영하는 "goodsoob-work" 데스크탑 앱이 이 repo 의 merged PR 들을 자동 수집해서 포트폴리오 카드로 만들어 (\`gh search prs --author @me is:merged\` 위임). **PR body 가 곧 포트폴리오 카드의 본문**이 되니까, 앞으로 이 repo 에서 PR 만들 땐 아래 양식을 따라야 해.

## 1. 이 repo 의 CLAUDE.md 에 규칙 추가

\`CLAUDE.md\` 가 있으면 그 파일에 아래 \`## PR 작성 규칙 (포트폴리오 호환)\` 섹션을 추가해 (기존 다른 섹션 다음). 없으면 새로 만들고 그 안에 넣어. 이미 같은 제목 섹션이 있으면 덮어쓰지 말고 차이만 본인에게 알려.

## 2. 규칙 본문 (CLAUDE.md 에 그대로 복사)

\`\`\`\`markdown
## PR 작성 규칙 (포트폴리오 호환)

이 repo 의 모든 PR 은 본인의 goodsoob-work vault \`portfolio/\` 카드의 본문이 됨. PR body 가 곧 포트폴리오 글감이라 다음 7섹션 템플릿대로 작성. UI/UX 작업이 주력이라 before/after 스크린샷이 핵심.

### PR body 템플릿

\`\`\`
## 한 줄 임팩트
{유저가 얻는 가치, 30자 이내 한 문장 — 카드 frontmatter impact_summary 로 옮길 줄}

## 문제 (Why)
{어떤 불편함/관찰을 풀었나 — 2-3줄}

## Before
![before](GitHub-image-url)
{캡션: 어떤 점이 안 좋았나}

## After
![after](GitHub-image-url)
{캡션: 무엇이 어떻게 달라졌나}

## 디자인 결정
- {왜 이 방향}
- {고려한 대안과 trade-off}

## 유저가 얻는 것
- {bullet 1-2개, 사용자 입장 서술}

## 카테고리
ui_ux
\`\`\`

### Claude 동작 규칙

사용자가 "PR 만들어줘" 라고 하면 다음 5가지를 먼저 물어볼 것 (이미 대화에서 확보된 정보면 재질문 X):

1. **의도** — 왜 했는지, 어떤 불편 해결
2. **유저 가치** — 한 줄 임팩트로 옮길 한 문장
3. **before/after 스크린샷** — 경로(local) 또는 URL. UI/UX 변경이면 필수. backend/infra/fix 면 생략 OK
4. **디자인 결정 근거** — 왜 이 방향, 고려한 대안
5. **카테고리** — \`ui_ux\` | \`backend\` | \`infra\` | \`fix\` | \`other\`

확보 후 위 템플릿대로 PR body 작성 → \`gh pr create\` (또는 사용 중인 ship 워크플로) 로 PR 생성.

**스크린샷 처리**: 로컬 파일 경로면 사용자에게 "GitHub PR 작성창에 drag&drop 후 생성된 user-images.githubusercontent.com URL 알려달라" 안내. URL 이면 markdown \`![before](url)\` 그대로 박음.

**카테고리 매핑** (goodsoob vault 카드 frontmatter \`category\` 와 정확히 일치):
- \`ui_ux\` — 시각/인터랙션/레이아웃/디자인
- \`backend\` — API, 데이터 모델, 비즈니스 로직
- \`infra\` — 빌드, 배포, CI, 패키지 의존성
- \`fix\` — 버그 수정 (UX 영향 작은 것)
- \`other\` — 문서, 리팩토링, 환경

**작은 변경은 main 직커밋 허용** — 오타/문서 한 줄/dep bump 처럼 포트폴리오 가치 없는 것은 PR 안 만들고 그냥 main 직커밋. PR 은 포트폴리오로 보여줄 만한 변경 단위.
\`\`\`\`

## 3. 완료 보고

CLAUDE.md 업데이트 했으면 "PR 규칙 추가했습니다" 라고 보고해줘. 이미 동일 섹션이 있어서 skip 했으면 그것도 알려줘. 추가 위치는 본인에게 따로 안 물어봐도 됨 — 자연스러운 곳 (다른 ## 섹션들 사이) 알아서 골라.
`;

export function buildPRGuidePrompt(): string {
  return PR_GUIDE_PROMPT;
}

// H2/H3 split: "한 줄 임팩트" 와 "카테고리" 섹션 추출.
// H3 = Claude 응답 paste (buildPRPrompt 출력 형식).
// H2 = PR body 자체 (포트폴리오 양식 — buildPRGuidePrompt 의 7섹션).
// 파싱 실패 시 null — 본인이 raw 텍스트 보고 직접 입력.
const IMPACT_HEADER = /^#{2,3}\s+한\s*줄\s*임팩트\s*$/m;
const CATEGORY_HEADER = /^#{2,3}\s+카테고리\s*$/m;
const NEXT_HEADER = /^#{2,3}\s/m;
// 슬러그 sanitize — 공백 / 백틱 / 따옴표 / 일반 markdown 노이즈 제거. underscore 와
// 하이픈은 slug 의 valid char 라 유지 (예: `ui_ux`).
// V0.7.3: 카테고리는 vault union 으로 풀려있어 enum 강제 X. 모델이 박은 슬러그를 그대로 받음.
// V0.7.4: 괄호+설명 패턴 제거 — "other(문구자동도구)" → "other".
const CATEGORY_PAREN_RE = /\([^)]*\)/g;
const CATEGORY_SANITIZE_RE = /[`"'*\s]/g;

export function parsePRResponse(
  text: string,
): { impact: string; category: string } | null {
  const impactSection = text.split(IMPACT_HEADER)[1]?.split(NEXT_HEADER)[0] ?? "";
  const categorySection =
    text.split(CATEGORY_HEADER)[1]?.split(NEXT_HEADER)[0] ?? "";

  const impact = impactSection
    .split("\n")
    .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 60); // 30자 못 지키는 응답 방어 (60자 hard cap)

  const categoryFirstLine = categorySection
    .split("\n")
    .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
    .filter(Boolean)[0] ?? "";

  // 자유 슬러그 — 괄호+설명 제거 후 노이즈 sanitize. 빈 = "other" fallback.
  const sanitized = categoryFirstLine
    .replace(CATEGORY_PAREN_RE, "")
    .replace(CATEGORY_SANITIZE_RE, "")
    .toLowerCase();
  const category = sanitized || "other";

  if (!impact) return null; // 파싱 실패
  return { impact, category };
}
