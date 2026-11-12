import { useQuery } from "@tanstack/react-query";
import { listNotebooks, loadNotebookDigest, readOrNull } from "../api/notebook";
import { useVault } from "../lib/vault/useVault";

// 노트북은 채팅(Claude)이 brain 에 쓰고 앱은 읽기만 한다 → 창 포커스 때마다 다시 읽게 staleTime 0.

export function useNotebooks() {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: ["notebooks"],
    queryFn: () => listNotebooks(adapter),
    enabled: isReady,
    staleTime: 0,
  });
}

export function useNotebookDigest(root: string | null) {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: ["notebook-digest", root],
    queryFn: () => loadNotebookDigest(adapter, root!),
    enabled: isReady && !!root,
    staleTime: 0,
  });
}

/** 원문 열람용. null = 파일 없음. */
export function useNotebookFile(path: string | null) {
  const { adapter, isReady } = useVault();
  return useQuery({
    queryKey: ["notebook-file", path],
    queryFn: () => readOrNull(adapter, path!),
    enabled: isReady && !!path,
    staleTime: 0,
  });
}
