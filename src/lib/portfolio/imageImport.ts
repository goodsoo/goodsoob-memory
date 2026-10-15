// V0.7.x — PR body 이미지 자동 import.
//
// 본인 PR template:
//   ## Before
//   ![before](<img-url>)
//   ## After
//   ![after](<img-url>)
//   ## 디자인 결정
//   ...
//
// GitHub drag&drop 이 최근에는 markdown `![]()` 대신 HTML `<img width="..." src="https://github.com/user-attachments/...">`
// 태그를 박는다. 따라서 두 가지 모두 매칭.
//
// before/after 분류 휴리스틱:
//   1. markdown alt text 가 "before" / "after" (대소문자 무시) → 그대로
//   2. 그 외엔 가장 가까운 위 H2 헤더가 "Before" / "After" 이면 그 라벨
//   3. 분류 불가 → label null (사용자가 옵시디안에서 채움)

export interface ExtractedPRImage {
  url: string;
  label: "before" | "after" | null;
  caption: string;
}

const MARKDOWN_IMG_RE = /!\[(.*?)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
const HTML_IMG_SRC_RE = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const HTML_IMG_ALT_RE = /\balt=["']([^"']*)["']/i;

function classifyByAlt(alt: string): "before" | "after" | null {
  const a = alt.toLowerCase().trim();
  if (a === "before" || a.startsWith("before") || a.includes("before")) {
    return "before";
  }
  if (a === "after" || a.startsWith("after") || a.includes("after")) {
    return "after";
  }
  return null;
}

function headerToLabel(line: string): "before" | "after" | null {
  // "## Before" / "## After" — 정확 매칭 (template). 다른 H2 만나면 null reset.
  const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
  if (!m) return null;
  const t = m[1].toLowerCase().trim();
  if (t === "before") return "before";
  if (t === "after") return "after";
  return null;
}

function isH2Header(line: string): boolean {
  return /^#{2,3}\s+/.test(line);
}

export function extractPRBodyImages(body: string): ExtractedPRImage[] {
  if (!body) return [];
  const out: ExtractedPRImage[] = [];
  const lines = body.split(/\r?\n/);
  let currentHeaderLabel: "before" | "after" | null = null;

  for (const line of lines) {
    // 헤더 라인이면 currentHeader 갱신, 같은 라인에 이미지는 없음.
    if (isH2Header(line)) {
      currentHeaderLabel = headerToLabel(line);
      continue;
    }

    // markdown 이미지
    MARKDOWN_IMG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKDOWN_IMG_RE.exec(line)) !== null) {
      const alt = m[1] ?? "";
      const url = m[2] ?? "";
      if (!url) continue;
      const label = classifyByAlt(alt) ?? currentHeaderLabel;
      out.push({ url, label, caption: "" });
    }

    // HTML 이미지 (GitHub drag&drop)
    HTML_IMG_SRC_RE.lastIndex = 0;
    while ((m = HTML_IMG_SRC_RE.exec(line)) !== null) {
      const tag = m[0];
      const url = m[1] ?? "";
      if (!url) continue;
      const altMatch = tag.match(HTML_IMG_ALT_RE);
      const alt = altMatch?.[1] ?? "";
      const label = classifyByAlt(alt) ?? currentHeaderLabel;
      out.push({ url, label, caption: "" });
    }
  }
  return out;
}

// URL 의 확장자 추론. user-attachments URL 처럼 path 가 uuid 라 확장자 없으면
// .png 로 fallback (가장 흔한 경우). content-type 기반 추론은 over-engineering.
export function inferImageExtension(url: string): string {
  const m = url.match(/\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "png";
}

// `_attachments/{slug}/{label}-{n}.{ext}` 또는 `_attachments/{slug}/img-{n}.{ext}`.
// 같은 label 끼리 1부터 N 카운트.
export function planImagePaths(
  slug: string,
  images: ExtractedPRImage[],
): Array<{ image: ExtractedPRImage; relPath: string }> {
  const counters = { before: 0, after: 0, other: 0 };
  return images.map((img) => {
    const ext = inferImageExtension(img.url);
    let name: string;
    if (img.label === "before") {
      counters.before++;
      name = `before-${counters.before}.${ext}`;
    } else if (img.label === "after") {
      counters.after++;
      name = `after-${counters.after}.${ext}`;
    } else {
      counters.other++;
      name = `img-${counters.other}.${ext}`;
    }
    return { image: img, relPath: `_portfolio/_attachments/${slug}/${name}` };
  });
}
