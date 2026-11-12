import { describe, expect, it } from "vitest";
import { citeLabel } from "./CiteButton";

describe("citeLabel", () => {
  it("번호 붙은 자료 → 자료 NN", () => {
    expect(citeLabel("sources/03-rokoko-motion-data-licensing.md")).toBe("자료 03");
  });
  it("번호 없는 파일 → 파일명, 길면 말줄임", () => {
    expect(citeLabel("glossary.md")).toBe("glossary");
    expect(citeLabel("interviews/team-lead-interview-notes.md")).toBe("team-lead-inter…");
  });
});
