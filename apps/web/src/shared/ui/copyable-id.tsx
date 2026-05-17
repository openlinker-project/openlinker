/**
 * CopyableId — mono-text identifier with copy-on-hover button (#775).
 *
 * For tables and detail rows where a raw internal id (UUID, ol_*) needs
 * to be visible AND grabbable. Lighter-weight than EntityLabel for the
 * cases that don't carry a human name or link.
 *
 * The trigger row (parent `<tr>` / `<.copyable-id-row>`) controls
 * visibility via the `.copyable-id__copy` rule — the copy button stays
 * hidden until hover/focus to keep dense tables clean.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from 'react';

interface CopyableIdProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** The full identifier to copy to the clipboard. */
  id: string;
  /** Optional shorter display label. Defaults to the full id. */
  label?: string;
}

export const CopyableId = forwardRef<HTMLSpanElement, CopyableIdProps>(function CopyableId(
  { id, label, className = '', ...props },
  ref,
): ReactElement {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    },
    [],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    });
  }, [id]);

  const classes = ['copyable-id', className].filter(Boolean).join(' ');

  return (
    <span ref={ref} className={classes} {...props}>
      <code className="copyable-id__value mono-text" title={id}>
        {label ?? id}
      </code>
      <button
        type="button"
        className="copyable-id__copy"
        onClick={handleCopy}
        aria-label={copied ? `Copied ${id}` : `Copy ${id}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
});
