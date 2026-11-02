import { describe, it, expect } from "vitest";
import {
  parseBase,
  baseSortKey,
  compareBases,
  baseTimeLabel,
  normalizeAudioList,
} from "./base";

describe("parseBase (실제 _audio 이름 패턴)", () => {
  const cases: [string, { date?: string; time?: string; label: string }][] = [
    ["20261029-1042", { date: "2026-10-29", time: "10:42", label: "20261029-1042" }],
    ["20261021-132023", { date: "2026-10-21", time: "13:20", label: "20261021-132023" }],
    ["20261029-1042-vm", { date: "2026-10-29", time: "10:42", label: "20261029-1042-vm" }],
    ["20261029-1042-vm2", { date: "2026-10-29", time: "10:42", label: "20261029-1042-vm2" }],
    ["20261008-1609_phai-studio_서창교", { date: "2026-10-08", time: "16:09", label: "phai-studio_서창교" }],
    ["20260821_미팅_정진용", { date: "2026-08-21", label: "미팅_정진용" }],
    ["20260821_미팅-2_정진용", { date: "2026-08-21", label: "미팅-2_정진용" }],
    ["20260826_카페미팅_정진용-공경철", { date: "2026-08-26", label: "카페미팅_정진용-공경철" }],
    ["20260827_전체워크샵-1_엔젤로보틱스연구소", { date: "2026-08-27", label: "전체워크샵-1_엔젤로보틱스연구소" }],
    ["20260901_phorce-sync_정진용-시경수", { date: "2026-09-01", label: "phorce-sync_정진용-시경수" }],
    ["20260901", { date: "2026-09-01", label: "20260901" }],
    ["New-Recording-3", { label: "New-Recording-3" }],
    ["회의 녹음 2", { label: "회의 녹음 2" }],
    ["20261329-1042", { label: "20261329-1042" }], // 13월 -> 무효
    ["20261029-2561", { label: "20261029-2561" }], // 25시 -> 무효 (날짜만으로도 안 맞음)
    ["20260230_x", { label: "20260230_x" }], // 2/30 무효
  ];
  it.each(cases)("%s", (base, want) => {
    const p = parseBase(base);
    expect(p.base).toBe(base);
    expect(p.date).toBe(want.date);
    expect(p.time).toBe(want.time);
    expect(p.label).toBe(want.label);
  });
});

describe("sort key", () => {
  it("날짜·시각 오름차순, 시각 미상은 같은 날 뒤, 날짜 미상은 맨 뒤", () => {
    const bases = [
      "New-Recording-3",
      "20261029-1346",
      "20261029_미팅_x",
      "20261029-1042",
      "20261028-2359",
    ];
    expect([...bases].sort(compareBases)).toEqual([
      "20261028-2359",
      "20261029-1042",
      "20261029-1346",
      "20261029_미팅_x",
      "New-Recording-3",
    ]);
  });
  it("baseSortKey 는 문자열 비교용", () => {
    expect(baseSortKey("20261029-0900") < baseSortKey("20261029-1000")).toBe(true);
    expect(baseSortKey("20261029-1000") < baseSortKey("zzz")).toBe(true);
  });
});

describe("baseTimeLabel", () => {
  it.each([
    ["20261029-1042", "10:42"],
    ["20260821_미팅_정진용", "2026.08.21"],
    ["New-Recording-3", ""],
  ])("%s -> %s", (b, want) => expect(baseTimeLabel(b)).toBe(want));
});

describe("normalizeAudioList", () => {
  it.each([
    [undefined, []],
    [null, []],
    ["", []],
    ["20261029-1042", ["20261029-1042"]],
    [[20261029, "20261029-1042"], ["20261029", "20261029-1042"]], // YAML 숫자
    [["a", "a", " b "], ["a", "b"]],
    [[{ x: 1 }, null, "c"], ["c"]],
    [123, ["123"]],
  ] as [unknown, string[]][])("%j", (raw, want) => {
    expect(normalizeAudioList(raw)).toEqual(want);
  });
});
