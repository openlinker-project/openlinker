import { forwardRef, useCallback, useState, type ComponentPropsWithoutRef } from 'react';
import { Link } from 'react-router-dom';

interface EntityLabelProps extends Omit<ComponentPropsWithoutRef<'span'>, 'id'> {
  id: string;
  loading?: boolean;
  name?: string | null;
  showId?: boolean;
  to?: string;
}

export const EntityLabel = forwardRef<HTMLSpanElement, EntityLabelProps>(function EntityLabel(
  { id, loading = false, name, showId = true, to, className = '', ...props },
  ref,
) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
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
      <Link to={to} className="entity-label__name entity-label__name--link">
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
        {copied ? '✓' : '📋'}
      </button>
    </span>
  );
});

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
