// 통합 검색 인덱스 — QuickSwitcher (Cmd+P) 가 사용. 2 도메인 (meeting / portfolio)
// 의 entry 를 단일 array 로 반환. modal open 시 enabled=true
// 로 lazy fetch. 검색 자체는 indexOf — 1MB 미만 vault 에서 sub-millisecond.
//
// 도메인별 본문 정책:
//   - meeting: 메인 파일 본문 (transcript/summary sidecar 는 제외 — 첫 발사 비용 절감)
//   - portfolio: frontmatter title + impact_summary + tags + project (body 제외 — 첫 발사 비용 절감)
// 본문 검색 부족 시 사용자 dogfood 후 확장.

import { useQuery } from "@tanstack/react-query";
import { useMeetings } from "./useMeetings";
import { usePortfolioWorks } from "./usePortfolio";
import { useVault } from "../lib/vault/useVault";

export type SearchDomain = "meeting" | "portfolio";

export type SearchEntry = {
  domain: SearchDomain;
  // 도메인별 id — 라우팅 시 사용. meeting=uid, portfolio=prSlug
  id: string;
  title: string;
  body: string;
  // 결과 행 보조 정보 (날짜, 카테고리 등)
  metaLabel: string | null;
  pinned: boolean;
};

const indexKey = ["global-search-index"] as const;

export function useGlobalSearchIndex(enabled: boolean) {
  const { adapter, isReady } = useVault();
  const meetings = useMeetings();
  const portfolio = usePortfolioWorks();

  const sourcesReady = meetings.isSuccess && portfolio.isSuccess;

  return useQuery({
    queryKey: indexKey,
    queryFn: async (): Promise<SearchEntry[]> => {
      const entries: SearchEntry[] = [];

      // meetings — 본문 lazy read. read 실패는 title 만이라도 indexing.
      for (const m of meetings.data ?? []) {
        try {
          const raw = (await adapter.exists(m.id)) ? await adapter.read(m.id) : "";
          // frontmatter 영역 빠른 strip (parser 안 거침)
          const stripped = raw.replace(/^---\n[\s\S]*?\n---\n+/, "");
          entries.push({
            domain: "meeting",
            id: m.uid,
            title: m.title,
            body: stripped,
            metaLabel: m.date,
            pinned: m.pinned,
          });
        } catch {
          entries.push({
            domain: "meeting",
            id: m.uid,
            title: m.title,
            body: "",
            metaLabel: m.date,
            pinned: m.pinned,
          });
        }
      }

      // portfolio — body 안 읽음 (PR 카드 100+ 가능, 첫 발사 비용 절감).
      // github_title + impact_summary 가 검색 대상. body 검색은 follow-up.
      for (const p of portfolio.data ?? []) {
        const fm = p.frontmatter;
        const searchBody = fm.impact_summary;
        entries.push({
          domain: "portfolio",
          id: p.prSlug,
          title: fm.github_title || p.prSlug,
          body: searchBody,
          metaLabel: fm.category ?? null,
          pinned: false,
        });
      }

      return entries;
    },
    enabled: enabled && isReady && sourcesReady,
    staleTime: 30_000,
  });
}
