import { describe, expect, it } from "vitest";
import {
  extractPRBodyImages,
  inferImageExtension,
  planImagePaths,
} from "./imageImport";

describe("extractPRBodyImages", () => {
  it("markdown alt 'before' / 'after' 우선", () => {
    const body = `
## Before
![before](https://example.com/before.png)
## After
![after](https://example.com/after.png)
`;
    expect(extractPRBodyImages(body)).toEqual([
      { url: "https://example.com/before.png", label: "before", caption: "" },
      { url: "https://example.com/after.png", label: "after", caption: "" },
    ]);
  });

  it("HTML <img> drag&drop 형태 + ## Before/After 헤더로 분류", () => {
    const body = `
## Before
<img width="500" alt="" src="https://github.com/user-attachments/assets/abc-1" />
## After
<img width="500" src="https://github.com/user-attachments/assets/abc-2" />
`;
    expect(extractPRBodyImages(body)).toEqual([
      {
        url: "https://github.com/user-attachments/assets/abc-1",
        label: "before",
        caption: "",
      },
      {
        url: "https://github.com/user-attachments/assets/abc-2",
        label: "after",
        caption: "",
      },
    ]);
  });

  it("다른 H2 만나면 라벨 reset → null", () => {
    const body = `
## Before
![](https://example.com/a.png)
## 디자인 결정
![](https://example.com/b.png)
`;
    expect(extractPRBodyImages(body)).toEqual([
      { url: "https://example.com/a.png", label: "before", caption: "" },
      { url: "https://example.com/b.png", label: null, caption: "" },
    ]);
  });

  it("빈 body → 빈 배열", () => {
    expect(extractPRBodyImages("")).toEqual([]);
    expect(extractPRBodyImages("아무 이미지 없음")).toEqual([]);
  });

  it("이미지가 헤더와 같은 라인에 있는 등 엣지: 일단 라벨 없으면 null", () => {
    expect(
      extractPRBodyImages("![pic](https://example.com/img.png)"),
    ).toEqual([
      { url: "https://example.com/img.png", label: null, caption: "" },
    ]);
  });
});

describe("inferImageExtension", () => {
  it("URL path 의 확장자 추출", () => {
    expect(inferImageExtension("https://example.com/a.png")).toBe("png");
    expect(inferImageExtension("https://example.com/a.JPG")).toBe("jpg");
    expect(inferImageExtension("https://example.com/a.jpeg")).toBe("jpg");
    expect(inferImageExtension("https://example.com/a.webp?v=1")).toBe("webp");
  });

  it("확장자 없으면 png fallback", () => {
    expect(
      inferImageExtension("https://github.com/user-attachments/assets/abc-uuid"),
    ).toBe("png");
  });
});

describe("planImagePaths", () => {
  it("label 별로 1부터 카운팅", () => {
    const plan = planImagePaths("owner-repo-1", [
      { url: "https://a/x.png", label: "before", caption: "" },
      { url: "https://a/y.png", label: "before", caption: "" },
      { url: "https://a/z.png", label: "after", caption: "" },
      { url: "https://a/w.png", label: null, caption: "" },
    ]);
    expect(plan.map((p) => p.relPath)).toEqual([
      "_portfolio/_attachments/owner-repo-1/before-1.png",
      "_portfolio/_attachments/owner-repo-1/before-2.png",
      "_portfolio/_attachments/owner-repo-1/after-1.png",
      "_portfolio/_attachments/owner-repo-1/img-1.png",
    ]);
  });
});
