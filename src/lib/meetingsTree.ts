import type { Meeting } from "../api/meetings";
import { meetingFolder } from "../api/meetings";

export interface MeetingsFolderNode {
  name: string; // last segment ("work", "2026")
  path: string; // full folder path ("work/2026") — root 은 ""
  children: MeetingsFolderNode[];
  meetings: Meeting[]; // 이 폴더 직속 메모만 (자식 폴더 메모는 children 노드 안에)
}

export interface MeetingsTree {
  folders: MeetingsFolderNode[]; // 최상위 폴더들 (root 안의 sub-folder)
  rootMeetings: Meeting[]; // root 직속 메모 ("기타" 그룹 — 폴더 없는 메모)
}

export type MeetingComparator = (a: Meeting, b: Meeting) => number;

const folderNameCompare = (a: string, b: string): number =>
  a.localeCompare(b, "ko");

// folder path 를 트리 노드로 ensure-create. 같은 path 가 이미 있으면 그대로 반환.
function ensureFolder(
  root: MeetingsFolderNode,
  folderPath: string,
): MeetingsFolderNode {
  if (folderPath === "") return root;
  const segments = folderPath.split("/");
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const childPath = segments.slice(0, i + 1).join("/");
    let child = node.children.find((c) => c.name === seg);
    if (!child) {
      child = { name: seg, path: childPath, children: [], meetings: [] };
      node.children.push(child);
    }
    node = child;
  }
  return node;
}

// flat list 의 메모를 폴더 트리로 변환. notes/{folder}/{title}.md 경로의
// folder 부분으로 grouping. folder 없는 메모는 rootMeetings 로.
// extraFolders — disk 에 mkdir 된 빈 폴더까지 보여주기 위해 추가 path list.
// path 는 vault-relative ("notes/work") 또는 notes-relative ("work") 둘 다 허용.
// sortMeetings 가 없으면 입력 순서 유지 (사용처에서 미리 정렬해서 넘기는 패턴 OK).
// 폴더는 segment 별 alphabetic (ko) — 정렬 popover 와 무관 (폴더는 위계, 메모만 정렬).
export function buildMeetingsTree(
  meetings: Meeting[],
  sortMeetings?: MeetingComparator,
  extraFolders: string[] = [],
): MeetingsTree {
  const rootNode: MeetingsFolderNode = {
    name: "",
    path: "",
    children: [],
    meetings: [],
  };

  // extra folder path 정규화 — vault root 기준 경로. 빈/`_`/`.` 세그먼트는 거름
  // (앱 소유·시스템 네임스페이스는 노트 폴더가 아님).
  for (const raw of extraFolders) {
    const p = raw.replace(/^\/+|\/+$/g, "");
    if (p === "") continue;
    if (p.split("/").some((s) => s === "" || s.startsWith(".") || s.startsWith("_")))
      continue;
    ensureFolder(rootNode, p);
  }

  for (const m of meetings) {
    const folder = meetingFolder(m.id);
    const node = ensureFolder(rootNode, folder);
    node.meetings.push(m);
  }

  // 자식 폴더 alphabetic. 메모는 옵션 sort.
  function sortNode(node: MeetingsFolderNode): void {
    node.children.sort((a, b) => folderNameCompare(a.name, b.name));
    if (sortMeetings) node.meetings.sort(sortMeetings);
    for (const c of node.children) sortNode(c);
  }
  sortNode(rootNode);

  return { folders: rootNode.children, rootMeetings: rootNode.meetings };
}

// 폴더 path 의 부모 path. "work/2026" → "work", "work" → "" (root).
export function folderParent(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

// 폴더 DnD 이동 가능 여부 — 사이드바 하이라이트(점선 valid/blocked)와 drop 게이트가
// 공유하는 순수 판정. srcPath: 끌고 있는 폴더 (notes-relative). destParent: drop 하려는
// 부모 폴더 ("" = root). 백엔드 moveFolder 의 가드와 동일 규칙 (defense-in-depth).
// 불가 케이스:
//  - root 자체는 끌 수 없음 (srcPath "")
//  - 자기 자신 위로 (destParent === srcPath)
//  - 자기 자손 폴더 안으로 (cycle: destParent 가 srcPath 의 하위)
//  - 이미 그 부모 안에 있음 (destParent === 현재 부모 → no-op)
export function canDropFolder(srcPath: string, destParent: string): boolean {
  if (srcPath === "") return false;
  if (destParent === srcPath) return false;
  if (destParent.startsWith(srcPath + "/")) return false;
  if (destParent === folderParent(srcPath)) return false;
  return true;
}

// 트리에서 모든 폴더 path 를 평면 list 로. picker UI 에 쓸 용도.
// 깊이 우선 (parent 먼저). root ("") 도 첫 entry 로 포함 (= "기타" / 폴더 없음).
export function flattenFolderPaths(tree: MeetingsTree): string[] {
  const out: string[] = [""];
  function walk(node: MeetingsFolderNode): void {
    out.push(node.path);
    for (const c of node.children) walk(c);
  }
  for (const f of tree.folders) walk(f);
  return out;
}
