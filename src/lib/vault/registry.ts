// vault 메타 (id/name/path/addedAt) + active vault id 의 localStorage 저장소.
// 본인 사용 사이드 프로젝트 — vault 자체 안에 메타 두면 닭-알 (vault 가 여러 개일 때
// 어느 vault 안의 vaults.json 을 source 로 삼냐) 이라 localStorage 채택.
//
// key 구조:
//  - goodsoob:vaults         → VaultEntry[]
//  - goodsoob:activeVaultId  → string | null

const VAULTS_KEY = "goodsoob:vaults";
const ACTIVE_VAULT_KEY = "goodsoob:activeVaultId";

export type VaultEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: number;
};

function readVaultsRaw(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(VAULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVaultEntry);
  } catch {
    return [];
  }
}

function isVaultEntry(v: unknown): v is VaultEntry {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.path === "string" &&
    typeof obj.addedAt === "number"
  );
}

function writeVaults(list: VaultEntry[]): void {
  localStorage.setItem(VAULTS_KEY, JSON.stringify(list));
}

function newId(): string {
  // 모던 브라우저 모두 지원. test 환경 (jsdom) 도 OK.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vault-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function getVaults(): VaultEntry[] {
  return readVaultsRaw();
}

export function getActiveVaultId(): string | null {
  return localStorage.getItem(ACTIVE_VAULT_KEY);
}

export function setActiveVaultId(id: string | null): void {
  if (id === null) localStorage.removeItem(ACTIVE_VAULT_KEY);
  else localStorage.setItem(ACTIVE_VAULT_KEY, id);
}

export function getActiveVault(): VaultEntry | null {
  const id = getActiveVaultId();
  if (!id) return null;
  return getVaults().find((v) => v.id === id) ?? null;
}

export function findVaultByPath(path: string): VaultEntry | null {
  return getVaults().find((v) => v.path === path) ?? null;
}

export function addVault(name: string, path: string): VaultEntry {
  const existing = findVaultByPath(path);
  if (existing) return existing;
  const entry: VaultEntry = {
    id: newId(),
    name: name.trim() || folderName(path),
    path,
    addedAt: Date.now(),
  };
  writeVaults([...getVaults(), entry]);
  return entry;
}

export function removeVault(id: string): void {
  writeVaults(getVaults().filter((v) => v.id !== id));
  if (getActiveVaultId() === id) setActiveVaultId(null);
}

export function renameVault(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  writeVaults(getVaults().map((v) => (v.id === id ? { ...v, name: trimmed } : v)));
}
