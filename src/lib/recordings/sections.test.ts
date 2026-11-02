import { describe, it, expect } from "vitest";
import {
  findSection,
  insertSection,
  removeSection,
  replaceSectionBody,
  sectionHash,
} from "./sections";
import { baseSortKey, baseTimeLabel } from "./base";

function ins(text: string, base: string, body = "본문", known?: string[]) {
  return insertSection(
    text,
    { base, timeLabel: baseTimeLabel(base), body, sortKey: baseSortKey(base) },
    known,
  );
}

const A = "20261029-1000";
const B = "20261029-0900";
const C = "20261029-1100";

describe("머리말 보존 [CRITICAL]", () => {
  const preambles = [
    "",
    "기존 전사 한 줄\n",
    "화자1: 안녕\n화자2: 네\n",
    "# 제목\n\n본문\n\n### 소제목\n내용\n",
    "## 일반 소제목\n내용\n", // 녹음 헤딩 아님
    "마지막 줄 개행 없음",
  ];
  it.each(preambles)("insert 후에도 머리말 바이트 그대로: %j", (pre) => {
    const out = ins(pre, A);
    expect(out.startsWith(pre)).toBe(true);
    const out2 = ins(out, B, "b", [A, B]);
    // 머리말은 그대로, 첫 녹음 헤딩 앞에서 끊어 비교
    expect(out2.startsWith(pre)).toBe(true);
  });

  it("머리말 있는 상태에서 시각 앞선 섹션을 끼워도 머리말 불변", () => {
    const pre = "옛 전사\n";
    const t1 = ins(pre, A);
    const t2 = ins(t1, B, "b");
    expect(t2.startsWith(pre)).toBe(true);
    expect(t2.indexOf("· " + B)).toBeLessThan(t2.indexOf("· " + A));
  });

  it("remove 후 머리말 보존", () => {
    const pre = "옛 전사\n";
    expect(removeSection(ins(pre, A), A)!.text).toBe(pre);
  });
});

describe("insertSection", () => {
  it("빈 사이드카", () => {
    expect(ins("", A, "내용")).toBe("## 10:00 · 20261029-1000\n\n내용\n");
  });
  it("멱등: 같은 base 헤딩이 있으면 무변경", () => {
    const once = ins("머리말\n", A);
    expect(ins(once, A, "다른 내용")).toBe(once);
    expect(ins(once, A, "다른 내용", [A])).toBe(once);
  });
  it("시각순 삽입 (앞·중간·뒤)", () => {
    let t = "";
    t = ins(t, A);
    t = ins(t, C);
    t = ins(t, B);
    const order = [...t.matchAll(/^## .* · (.+)$/gm)].map((m) => m[1]);
    expect(order).toEqual([B, A, C]);
  });
  it("시각 미상은 맨 뒤, 이후 시각 있는 건 그 앞", () => {
    const U = "New-Recording-3";
    let t = ins("", A);
    t = ins(t, U);
    t = ins(t, C);
    const order = [...t.matchAll(/^## .* · (.+)$/gm)].map((m) => m[1]);
    expect(order).toEqual([A, C, U]);
    expect(t).toContain("## 시각 미상 · New-Recording-3");
  });
  it("사용자가 순서를 바꿔놔도 재정렬하지 않음", () => {
    const manual = `## 11:00 · ${C}\n\nc\n\n## 10:00 · ${A}\n\na\n`;
    const out = ins(manual, B, "b", [A, C]);
    // B(09:00) 는 첫 번째로 큰 키(C) 앞에 들어가고 나머지 순서 유지
    const order = [...out.matchAll(/^## .* · (.+)$/gm)].map((m) => m[1]);
    expect(order).toEqual([B, C, A]);
  });
  it("개행 없이 끝나는 텍스트에도 빈 줄로 분리", () => {
    expect(ins("abc", A, "x")).toBe("abc\n\n## 10:00 · 20261029-1000\n\nx\n");
  });
  it("본문 앞뒤 공백 정리", () => {
    expect(ins("", A, "\n\n  내용  \n\n")).toBe("## 10:00 · 20261029-1000\n\n  내용\n");
  });
});

describe("헤딩 정확 일치 (공백·-·한글 base)", () => {
  const bases = [
    "20260826_카페미팅_정진용-공경철",
    "20260908_미팅-2_정진용-시경수",
    "회의 녹음 2",
    "20261029-1042-vm",
    "20261008-1609_phai-studio_서창교",
  ];
  it.each(bases)("%s", (b) => {
    const t = ins(ins("", "20260101-0000", "앞"), b, "내용 " + b);
    const s = findSection(t, b);
    expect(s).not.toBeNull();
    expect(s!.body.trim()).toBe("내용 " + b);
    expect(s!.heading.endsWith(" · " + b)).toBe(true);
  });
  it("접미사만 같은 다른 base 와 혼동하지 않음", () => {
    const t = `## 09:00 · x-${A}\n\nother\n`;
    expect(findSection(t, A)).toBeNull();
    expect(findSection(t, `x-${A}`)).not.toBeNull();
  });
  it("정규식 메타문자가 들어간 base", () => {
    const b = "a.b(c)+[d]";
    const t = ins("", b);
    expect(findSection(t, b)).not.toBeNull();
    expect(findSection(t, "aXb(c)+[d]")).toBeNull();
  });
  it("'## ' 없이 · 만 있는 줄·### 헤딩은 헤딩 아님", () => {
    const t = `### 10:00 · ${A}\n본문\n10:00 · ${A}\n`;
    expect(findSection(t, A)).toBeNull();
  });
});

describe("섹션 경계", () => {
  it("knownBases 없으면 아무 `## ` 줄이 경계 (폴백)", () => {
    const t = `## 10:00 · ${A}\n\n앞\n\n## 메모\n\n뒤\n`;
    expect(findSection(t, A)!.body).toBe("\n앞\n\n");
  });
  it("knownBases 있으면 본문 안 `## 소제목` 은 본문", () => {
    const t = `## 10:00 · ${A}\n\n앞\n\n## 메모\n\n뒤\n\n## 11:00 · ${C}\n\nc\n`;
    const s = findSection(t, A, [A, C])!;
    expect(s.body).toContain("## 메모");
    expect(s.body).toContain("뒤");
    expect(s.body).not.toContain("c\n");
  });
  it("CRLF 헤딩도 인식", () => {
    expect(findSection(`## 10:00 · ${A}\r\n\r\nx\r\n`, A)).not.toBeNull();
  });
});

describe("removeSection", () => {
  it("헤딩 못 찾으면 null (호출자는 텍스트 무변경)", () => {
    expect(removeSection("머리말\n", A)).toBeNull();
    expect(removeSection(`## 10:00 · ${A}-x\n\nb\n`, A)).toBeNull();
    expect(removeSection("", A)).toBeNull();
  });
  it("body 반환은 앞뒤 공백 정리", () => {
    const t = ins("", A, "첫줄\n둘째줄");
    expect(removeSection(t, A)!.body).toBe("첫줄\n둘째줄");
  });
  it("중간 섹션만 제거, 나머지 유지", () => {
    let t = "머리말\n";
    for (const b of [B, A, C]) t = ins(t, b, `body-${b}`);
    const r = removeSection(t, A)!;
    expect(r.body).toBe(`body-${A}`);
    expect(findSection(r.text, A)).toBeNull();
    expect(findSection(r.text, B)!.body.trim()).toBe(`body-${B}`);
    expect(findSection(r.text, C)!.body.trim()).toBe(`body-${C}`);
    expect(r.text.startsWith("머리말\n")).toBe(true);
  });
});

describe("insert -> remove 왕복 무손실", () => {
  const originals = [
    "",
    "머리말\n",
    "머리말\n\n## 09:00 · 20261029-0900\n\n기존\n",
    `머리말\n\n## 09:00 · ${B}\n\nb\n\n## 11:00 · ${C}\n\nc\n`,
  ];
  const targets = [A, "20261029-0800", "20261029-1200", "New-Recording-3"];
  for (const orig of originals) {
    for (const base of targets) {
      it(`${JSON.stringify(orig).slice(0, 30)} + ${base}`, () => {
        const known = [B, C, base];
        const inserted = insertSection(
          orig,
          { base, timeLabel: baseTimeLabel(base), body: "내용\n여러 줄", sortKey: baseSortKey(base) },
          known,
        );
        const removed = removeSection(inserted, base, known)!;
        expect(removed.text).toBe(orig);
        expect(removed.body).toBe("내용\n여러 줄");
      });
    }
  }
});

describe("비정규형 끝 공백", () => {
  it("끝 섹션 제거 시 앞 텍스트 끝 공백줄은 개행 1개로 접힘", () => {
    expect(removeSection(ins("머리말\n\n", A), A)!.text).toBe("머리말\n");
  });
});

describe("replaceSectionBody", () => {
  it("헤딩 유지, 본문만 교체, 이웃 섹션 보존", () => {
    let t = "머리말\n";
    for (const b of [B, A, C]) t = ins(t, b, `body-${b}`);
    const out = replaceSectionBody(t, A, "새 본문", [B, A, C])!;
    expect(findSection(out, A, [B, A, C])!.heading).toBe(`## 10:00 · ${A}`);
    expect(findSection(out, A, [B, A, C])!.body.trim()).toBe("새 본문");
    expect(findSection(out, B)!.body.trim()).toBe(`body-${B}`);
    expect(findSection(out, C)!.body.trim()).toBe(`body-${C}`);
    expect(out.startsWith("머리말\n")).toBe(true);
  });
  it("끝 섹션 교체는 정규형(끝 개행 1개)", () => {
    const out = replaceSectionBody(ins("", A, "old"), A, "new\n\n")!;
    expect(out).toBe(`## 10:00 · ${A}\n\nnew\n`);
  });
  it("헤딩 없으면 null", () => {
    expect(replaceSectionBody("x\n", A, "y")).toBeNull();
  });
});

describe("sectionHash", () => {
  it("끝 줄바꿈·앞뒤 공백 무시", () => {
    const h = sectionHash("내용\n둘째");
    expect(sectionHash("내용\n둘째\n")).toBe(h);
    expect(sectionHash("\n\n내용\n둘째\n\n")).toBe(h);
  });
  it("내용이 다르면 해시도 다름", () => {
    expect(sectionHash("a")).not.toBe(sectionHash("b"));
  });
  it("8자리 hex, 빈 문자열도 안전", () => {
    expect(sectionHash("")).toMatch(/^[0-9a-f]{8}$/);
    expect(sectionHash("한글")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("findSection.body 해시 == insert 시 넘긴 body 해시 (updateMeeting 끝 \\n 추가 후에도)", () => {
    const body = "화자1: 안녕\n화자2: 네";
    const t = ins("", A, body) + "\n";
    expect(sectionHash(findSection(t, A)!.body)).toBe(sectionHash(body));
  });
});
