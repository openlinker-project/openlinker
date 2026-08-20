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
  /**
   * Composites that pair this label with their own copy affordance (e.g.
   * `ConnectionCell`'s `CopyableId` line) opt the built-in button out, so the
   * same id never grows two copy controls (#2027).
   */
  showCopy?: boolean;
  /**
   * Accessible name of the built-in copy button. Defaults to `Copy {id}`, which
   * a screen reader spells out character by character — 32 hex digits on every
   * row of a table. A caller that can resolve the id to something human should
   * pass it ("Copy order ID 6839-2911-4402"), mirroring `CopyableId`'s
   * `copyLabel` (#1996). Kept optional so no existing call site changes.
   */
  copyLabel?: string;
  /** Accessible name once the copy succeeded. Defaults to `Copied {id}`. */
  copiedLabel?: string;
  /**
   * `title` on the rendered name, overriding the default (the name itself).
   *
   * For a caller that SHORTENS what it passes as `name`: the default would then
   * tooltip the shortened form, leaving the full value unreachable to a sighted
   * user. `OrderIdentityCell` passes the full order number, because Allegro's
   * order number is a 36-character id that its own cell must shorten (#2089).
   */
  nameTitle?: string;
  to?: string;
  /**
   * Fired when the inner name link is clicked (navigation), never when the
   * "Copy id" button is clicked — the outer `<span>` wraps both, so a plain
   * `onClick` on the whole component would double-fire on Copy clicks too.
   */
  onNavigate?: () => void;
}

export const EntityLabel = forwardRef<HTMLSpanElement, EntityLabelProps>(function EntityLabel(
  {
    id,
    loading = false,
    name,
    showId = true,
    showCopy = true,
    copyLabel,
    copiedLabel,
    nameTitle,
    to,
    onNavigate,
    className = '',
    ...props
  },
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
  const copyButtonLabel = copied ? (copiedLabel ?? `Copied ${id}`) : (copyLabel ?? `Copy ${id}`);
  const resolvedName = name ?? null;
  // `?? undefined` rather than `?? id`: both consumers sit inside the
  // `resolvedName ?` branch below, so the third rung is unreachable — it exists
  // only because `title` takes `string | undefined`, and defaulting an
  // unreachable rung to the raw id would read as a behaviour somebody relies on.
  const resolvedTitle = nameTitle ?? resolvedName ?? undefined;

  const nameNode = loading ? (
    <span className="entity-label__name entity-label__name--loading" aria-busy="true">
      …
    </span>
  ) : resolvedName ? (
    to ? (
      <Link
        to={to}
        className="entity-label__name entity-label__name--link"
        onClick={onNavigate}
        title={resolvedTitle}
      >
        {resolvedName}
      </Link>
    ) : (
      <span className="entity-label__name" title={resolvedTitle}>
        {resolvedName}
      </span>
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
      {showCopy ? (
        <button
          type="button"
          className="entity-label__copy"
          onClick={handleCopy}
          aria-label={copyButtonLabel}
          // `title={id}`, NOT a mirror of `aria-label` (#2091). A sighted operator
          // needs to know what "Copy" writes on a row whose visible identity is
          // not the id being copied — `OrderIdentityCell` renders the order NUMBER
          // and copies the internal id, and with `showId={false}` there is no
          // `entity-label__id` chip beside it to make the target visible. Mirroring
          // the accessible name would make `title` the accessible *description* of
          // a control that already has that exact string as its name, so a screen
          // reader announces it twice; the id adds information instead.
          title={id}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      ) : null}
    </span>
  );
});

const OL_ID_PATTERN = /^(ol_[a-z][a-z0-9-]*_)(.+)$/;

/**
 * Shared id-shortening rule (#2027). Exported so composites like
 * `ConnectionCell` that pair `EntityLabel` with `CopyableId` reuse the exact
 * same shortening algorithm instead of growing a second implementation.
 */
export function shortenId(id: string): string {
  const match = OL_ID_PATTERN.exec(id);
  if (match) {
    const [, prefix, rest] = match;
    if (rest.length <= 6) return id;
    return `${prefix}${rest.slice(0, 4)}…${rest.slice(-2)}`;
  }
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
