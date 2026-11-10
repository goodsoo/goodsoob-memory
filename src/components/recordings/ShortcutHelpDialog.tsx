import { RECORDING_SHORTCUTS } from "../../lib/recordings/shortcuts";
import { Kbd } from "../common/Kbd";
import { Modal } from "../common/Modal";
import { Text } from "../common/Text";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ShortcutHelpDialog({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} size="sm" ariaLabel="단축키">
      <div className="flex flex-col gap-3 p-5">
        <Text variant="h4" as="h2">
          단축키
        </Text>
        <ul>
          {RECORDING_SHORTCUTS.map((s) => (
            <li
              key={`${s.label}|${s.keys.join("")}`}
              className="flex items-center gap-3 py-2"
              style={{ borderBottom: "1px solid var(--line)" }}
            >
              <div className="min-w-0 flex-1">
                <Text variant="body" as="span">
                  {s.label}
                </Text>
                {s.note && (
                  <Text variant="caption" color="muted" as="span" className="ml-2">
                    {s.note}
                  </Text>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
