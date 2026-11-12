import { describe, expect, it } from "vitest";
import { checkCite, checkNotebook, type ReadFile } from "./check";

const root = "nb";
const files: Record<string, string> = {
  "nb/sources/a.md": "# A\n\n원문에는 이 문장이\n그대로 있다.\n",
};
const read: ReadFile = async (p) => files[p] ?? null;

const readme = (body: string, defs: string) =>
  `---\ntype: notebook\n---\n## 지금까지의 결론\n\n${body}\n\n## 조사 필요\n- x\n\n${defs}\n`;

describe("checkCite", () => {
  it("ok / mismatch / not-found / outside", async () => {
    expect((await checkCite(root, "sources/a.md", "이 문장이 그대로", read)).status).toBe("ok");
    expect((await checkCite(root, "sources/a.md", "없는 문장", read)).status).toBe("mismatch");
    expect(await checkCite(root, "sources/z.md", "x", read)).toMatchObject({ status: "missing", reason: "not-found" });
    expect(await checkCite(root, "../a.md", "x", read)).toMatchObject({ status: "missing", reason: "outside" });
  });
});

describe("checkNotebook", () => {
  it("모두 정상 → failures 0 (퀴즈 없음은 경고)", async () => {
    const r = await checkNotebook(root, readme("- 주장[^1]\n- (내 판단) 판단", `[^1]: sources/a.md "그대로 있다."`), read);
    expect(r.failures).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toEqual(["퀴즈 파일 없음"]);
    expect(r.claimCount).toBe(2);
  });

  it("틀린 발췌 · 근거 없음 · 퀴즈 인용 불일치 → failures", async () => {
    const quiz = JSON.stringify({
      generated_at: "x",
      questions: [
        { id: "q1", q: "?", choices: ["a", "b", "c", "d"], answer: 0, explanation: "", cites: [{ src: "sources/a.md", quote: "지어낸 발췌" }] },
      ],
    });
    const r = await checkNotebook(
      root,
      readme("- 주장[^1]\n- 근거 없는 말", `[^1]: sources/a.md "원문에 없는 문장"`),
      async (p) => (p === "nb/_digest/quiz.json" ? quiz : read(p)),
    );
    expect(r.failures).toHaveLength(3);
    expect(r.questionCount).toBe(1);
  });
});
