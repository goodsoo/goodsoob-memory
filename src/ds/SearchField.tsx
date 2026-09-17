import type { InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import './styles/search-field.css';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  /** Renders a clear (×) button when value is non-empty and onClear is provided. */
  onClear?: () => void;
  className?: string;
}

/**
 * Canonical DS SearchField — thin React wrapper. Spec: docs/components.md §19.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  onClear,
  className,
  ...rest
}: SearchFieldProps) {
  const hasClear = !!onClear && !!value;

  const wrapperClasses = [
    'ds-search',
    hasClear ? 'ds-search--clearable' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <span className="ds-search__icon" aria-hidden="true">
        <Search size={16} strokeWidth={2.4} />
      </span>
      <input
        type="search"
        className="ds-search__input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
      {hasClear && (
        <button
          type="button"
          className="ds-search__clear"
          onClick={onClear}
          aria-label="검색어 지우기"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
