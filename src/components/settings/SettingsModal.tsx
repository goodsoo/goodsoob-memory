import { useState } from "react";
import { X, Keyboard, FolderOpen, Archive, HelpCircle, Image as ImageIcon, Monitor } from "lucide-react";
import { ShortcutsSection } from "./ShortcutsSection";
import { HelpSection } from "./HelpSection";
import { VaultSection } from "./VaultSection";
import { BackupSection } from "./BackupSection";
import { AttachmentsSection } from "./AttachmentsSection";
import { DisplaySection } from "./DisplaySection";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { NavItem } from "@goodsoob/ds";
import { Text } from "../common/Text";

export type SettingsSection = "vault" | "backup" | "attachments" | "display" | "shortcuts" | "help";

type Props = {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
};

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Keyboard }> = [
  { id: "vault", label: "Vault 폴더", icon: FolderOpen },
  { id: "backup", label: "백업", icon: Archive },
  { id: "attachments", label: "첨부 정리", icon: ImageIcon },
  { id: "display", label: "화면", icon: Monitor },
  { id: "shortcuts", label: "단축키", icon: Keyboard },
  { id: "help", label: "도움말", icon: HelpCircle },
];

export function SettingsModal({ open, onClose, initialSection = "vault" }: Props) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

  return (
    <Modal open={open} onClose={onClose} size="lg" orientation="horizontal" ariaLabel="설정">
      <aside
          className="flex w-44 shrink-0 flex-col"
          style={{
            background: "var(--bg)",
            borderRight: "1px solid var(--line)",
          }}
        >
          <Text
            variant="body"
            weight="semibold"
            as="div"
            className="flex h-12 shrink-0 items-center px-4"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            설정
          </Text>
          <nav className="flex-1 overflow-y-auto py-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === section;
              return (
                <NavItem
                  key={id}
                  active={active}
                  icon={<Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.5} />}
                  onClick={() => setSection(id)}
                  className="rounded-none px-4 py-2"
                  style={{
                    background: active ? "var(--surface)" : "transparent",
                    color: active ? "var(--ink)" : "var(--sub)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {label}
                </NavItem>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header
            className="flex h-12 shrink-0 items-center justify-between px-5"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            <Text variant="body" weight="semibold" as="h2">
              {SECTIONS.find((s) => s.id === section)?.label}
            </Text>
            <Button
              variant="icon"
              onClick={onClose}
              aria-label="닫기"
              title="닫기  ESC"
              style={{ color: "var(--faint)" }}
            >
              <X className="h-4 w-4" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {section === "vault" ? (
              <VaultSection onAfterSwitch={onClose} />
            ) : section === "backup" ? (
              <BackupSection />
            ) : section === "attachments" ? (
              <AttachmentsSection />
            ) : section === "display" ? (
              <DisplaySection />
            ) : section === "shortcuts" ? (
              <ShortcutsSection />
            ) : (
              <HelpSection />
            )}
          </div>
        </section>
    </Modal>
  );
}
