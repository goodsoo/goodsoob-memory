import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import './styles/commandblock.css';

export interface CommandBlockProps {
  /** The command string to display and copy. */
  command: string;
  /** Optional label shown above the container (uppercase, faint). */
  label?: string;
  className?: string;
}

/**
 * Canonical DS CommandBlock — single-line terminal command display with copy.
 *
 * CSS classes carry all styling (tokens → styles/commandblock.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §14.
 */
export function CommandBlock({ command, label, className }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const wrapperClass = ['ds-commandblock', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass}>
      {label && <span className="ds-commandblock__label">{label}</span>}
      <div className="ds-commandblock__container">
        <code className="ds-commandblock__code">{command}</code>
        <button
          type="button"
          className="ds-commandblock__copy"
          onClick={handleCopy}
          aria-label={copied ? '복사됨' : '명령어 복사'}
        >
          {copied
            ? <Check size={12} strokeWidth={2} />
            : <Copy size={12} strokeWidth={2} />
          }
        </button>
      </div>
    </div>
  );
}
