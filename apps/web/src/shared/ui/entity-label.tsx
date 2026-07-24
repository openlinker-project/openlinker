import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { Link } from 'react-router-dom';

interface EntityLabelProps extends Omit<ComponentPropsWithoutRef<'span'>, 'id'> {
  id: string;
  loading?: boolean;
  name?: string | null;
  showId?: boolean;
  to?: string;
  /**
   * Fired when the inner name link is clicked (navigation), never when the
   * "Copy id" button is clicked — the outer `<span>` wraps both, so a plain
   * `onClick` on the whole component would double-fire on Copy clicks too.
   */
  onNavigate?: () => void;
}

export const EntityLabel = forwardRef<HTMLSpanElement, EntityLabelProps>(function EntityLabel(
  { id, loading = false, name, showId = true, to, onNavigate, className = '', ...props },
  ref,
) {
  const [copied, setCopied] = useState(false);
  // Track the "Copied" badge timer so we can cancel it on unmount — otherwise
  // the 1.5 s setState fires after the JSDOM env is torn down in unit tests
  // and crashes the run with `ReferenceError: window is not defined`.
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
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    });
  }, [id]);

  const classes = ['entity-label', className].filter(Boolean).join(' ');
  const resolvedName = name ?? null;

  const nameNode = loading ? (
    <span className="entity-label__name entity-label__name--loading" aria-busy="true">
      …
    </span>
  ) : resolvedName ? (
    to ? (
      <Link to={to} className="entity-label__name entity-label__name--link" onClick={onNavigate}>
        {resolvedName}
      </Link>
    ) : (
      <span className="entity-label__name">{resolvedName}</span>
    )
  ) : (
    <span className="entity-label__name entity-label__name--unknown" title={id}>
      Unknown
    </span>
  );

  return (
    <span ref={ref} className={classes} {...props}>
      {nameNode}
      {showId ? (
        <code className="entity-label__id mono-text" title={id}>
          {shortenId(id)}
        </code>
      ) : null}
      <button
        type="button"
        className="entity-label__copy"
        onClick={handleCopy}
        aria-label={copied ? `Copied ${id}` : `Copy ${id}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
});

const OL_ID_PATTERN = /^(ol_[a-z][a-z0-9-]*_)(.+)$/;

function shortenId(id: string): string {
  const match = OL_ID_PATTERN.exec(id);
  if (match) {
    const [, prefix, rest] = match;
    if (rest.length <= 6) return id;
    return `${prefix}${rest.slice(0, 4)}…${rest.slice(-2)}`;
  }
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
