import { describe, expect, it } from "vitest";
import {
  BRIEFING_HEADING,
  extractSection,
  parseBriefing,
  parseFootnoteDefs,
  parseTodoList,
  resolveSrc,
  verifyQuote,
} from "./digest";

const readme = (section: string, tail = "") =>
  `---\ntype: notebook\n---\n\n# 허브\n\n## ${BRIEFING_HEADING}\n\n${section}\n\n## 폴더 구조\n\n- 무관 불릿\n${tail}`;

describe("extractSection", () => {
  it("섹션 없음 → null", () => {
    expect(extractSection("# a\n\n## 다른\n- x", BRIEFING_HEADING)).toBeNull();
  });
  it("다음 H2 직전까지 (H3 는 포함)", () => {
    const s = extractSection(readme("- a\n\n### 소제목\n- b"), BRIEFING_HEADING)!;
    expect(s.lines.map((l) => l.text).join("\n")).toContain("### 소제목");
    expect(s.lines.map((l) => l.text).join("\n")).not.toContain("무관 불릿");
  });
  it("문서 끝에서 끝남", () => {
    const s = extractSection(`## ${BRIEFING_HEADING}\n- a\n- b`, BRIEFING_HEADING)!;
    expect(s.lines.filter((l) => l.text.trim()).length).toBe(2);
  });
});

describe("parseFootnoteDefs", () => {
  it("정상 정의", () => {
    const { defs, issues } = parseFootnoteDefs(`[^1]: sources/01-a.md "원문 발췌"`);
    expect(issues).toEqual([]);
    expect(defs.get("1")).toMatchObject({ src: "sources/01-a.md", quote: "원문 발췌" });
  });
  it("발췌 안의 큰따옴표 허용 (첫 \" ~ 줄 마지막 \")", () => {
    const { defs } = parseFootnoteDefs(`[^a]: sources/x.md "그는 "좋다"고 했다"`);
    expect(defs.get("a")!.quote).toBe(`그는 "좋다"고 했다`);
  });
  it("경로에 공백 허용", () => {
    const { defs } = parseFootnoteDefs(`[^1]: sources/01 a b.md "q"`);
    expect(defs.get("1")!.src).toBe("sources/01 a b.md");
  });
  it("따옴표 없음 / 경로 없음 → 문법 오류", () => {
    const { defs, issues } = parseFootnoteDefs(`[^1]: sources/a.md 발췌\n[^2]: "q"`);
    expect(defs.size).toBe(0);
    expect(issues.map((i) => i.kind)).toEqual(["bad-def", "bad-def"]);
  });
});

describe("parseBriefing", () => {
  it("섹션 없음 → 빈 브리핑", () => {
    const b = parseBriefing("# a\n본문");
    expect(b.found).toBe(false);
    expect(b.claims).toEqual([]);
  });

  it("불릿 · 문단 · 중첩 불릿이 각자 단위", () => {
    const b = parseBriefing(
      readme(
        "첫 문단 첫 줄\n이어지는 줄[^1]\n\n- 불릿 A[^1]\n  - 중첩 B (부모 인용 상속 X)\n- 불릿 C\n  이어짐[^1]",
        `\n[^1]: sources/a.md "x"\n`,
      ),
    );
    expect(b.claims.map((c) => [c.text, c.depth, c.kind])).toEqual([
      ["첫 문단 첫 줄 이어지는 줄", 0, "source"],
      ["불릿 A", 0, "source"],
      ["중첩 B (부모 인용 상속 X)", 1, "unsupported"],
      ["불릿 C 이어짐", 0, "source"],
    ]);
  });

  it("종류: 각주 / 마커 / 마커+각주 / 둘 다 없음", () => {
    const b = parseBriefing(
      readme(
        "- 자료[^1][^2]\n- (내 판단) 판단\n- (AI 해석) 해석\n- (내 판단) 둘 다[^1]\n- 근거 없는 말",
        `\n[^1]: sources/a.md "x"\n[^2]: sources/b.md "y"\n`,
      ),
    );
    expect(b.claims.map((c) => c.kind)).toEqual([
      "source",
      "judgment",
      "ai",
      "judgment",
      "unsupported",
    ]);
    expect(b.claims[0].refs).toEqual(["1", "2"]);
    expect(b.claims[1].text).toBe("판단");
    expect(b.claims[3].refs).toEqual(["1"]);
    expect(b.issues.filter((i) => i.kind === "unsupported")).toHaveLength(1);
  });

  it("헤딩 줄은 단위가 아님", () => {
    const b = parseBriefing(readme("### 소제목\n- (내 판단) a"));
    expect(b.claims).toHaveLength(1);
  });

  it("정의 누락 ref → missing-def, 미사용 정의 → unused-def", () => {
    const b = parseBriefing(readme("- a[^9]", `\n[^1]: sources/a.md "x"\n`));
    const kinds = b.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(["missing-def", "unused-def"]);
  });

  it("섹션 안에 있는 정의 줄은 단위로 안 셈", () => {
    const b = parseBriefing(readme(`- a[^1]\n\n[^1]: sources/a.md "x"`));
    expect(b.claims).toHaveLength(1);
    expect(b.defs.get("1")).toBeDefined();
  });
});

describe("verifyQuote", () => {
  it("정확 일치 → 원문 오프셋", () => {
    const src = "앞부분. 핵심 문장이 여기 있다. 뒷부분";
    const r = verifyQuote(src, "핵심 문장이 여기 있다.");
    expect(r.ok).toBe(true);
    if (r.ok) expect(src.slice(r.rawStart, r.rawEnd)).toBe("핵심 문장이 여기 있다.");
  });
  it("줄바꿈 · 연속 공백 차이 → 일치 + 원문 오프셋", () => {
    const src = "머리\n\n핵심   문장이\n  여기 있다.\n꼬리";
    const r = verifyQuote(src, "핵심 문장이 여기   있다.");
    expect(r.ok).toBe(true);
    if (r.ok) expect(src.slice(r.rawStart, r.rawEnd)).toBe("핵심   문장이\n  여기 있다.");
  });
  it("발췌 앞뒤 공백은 무시", () => {
    const r = verifyQuote("abc def", "  abc ");
    expect(r).toEqual({ ok: true, rawStart: 0, rawEnd: 3 });
  });
  it("한 글자 다름 → 불일치", () => {
    expect(verifyQuote("핵심 문장이 여기 있다.", "핵심 문장이 거기 있다.").ok).toBe(false);
  });
  it("빈 발췌 → 불일치", () => {
    expect(verifyQuote("abc", "   ").ok).toBe(false);
  });
  it("마크다운 기호는 정규화 안 함", () => {
    expect(verifyQuote("**굵게** 글", "굵게 글").ok).toBe(false);
  });
});

describe("resolveSrc", () => {
  const root = "angel-robotics/projects/studio-biz";
  it("노트북 내부 OK", () => {
    expect(resolveSrc(root, "sources/01-a.md")).toBe(`${root}/sources/01-a.md`);
    expect(resolveSrc(root, "./sources/01-a.md")).toBe(`${root}/sources/01-a.md`);
  });
  it("`..` · 절대경로 · 빈 경로 거부", () => {
    expect(resolveSrc(root, "../other.md")).toBeNull();
    expect(resolveSrc(root, "sources/../../x.md")).toBeNull();
    expect(resolveSrc(root, "/etc/passwd")).toBeNull();
    expect(resolveSrc(root, "C:\\x.md")).toBeNull();
    expect(resolveSrc(root, "")).toBeNull();
  });
  it("vault 루트 노트북", () => {
    expect(resolveSrc("", "sources/a.md")).toBe("sources/a.md");
  });
});

describe("parseTodoList", () => {
  it("## 조사 필요 불릿 목록", () => {
    const md = "## 조사 필요\n\n- 하나\n- 둘\n  - 셋\n\n## 다음\n- 무관";
    expect(parseTodoList(md)).toEqual(["하나", "둘", "셋"]);
  });
  it("섹션 없음 → 빈 배열", () => {
    expect(parseTodoList("# x")).toEqual([]);
  });
});
