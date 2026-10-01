/**
 * ConnectionChip — a connection's channel as one clickable chip (#3670).
 *
 * Before this, a list showed a non-clickable `.channel-pill` beside a separate,
 * usually truncated name link: the large recognisable element did nothing and
 * the clickable one was a fragment. The chip is now the link.
 *
 * At rest it shows only the platform (`Allegro`, `Subiekt GT`); the connection
 * name slides out to the right on hover or keyboard focus. The slide-out is
 * absolutely positioned so the row never reflows, and on a device with no hover
 * it is rendered statically instead, because a name that only appears on hover
 * would otherwise never appear there at all.
 *
 * It keeps the three behaviours `ConnectionEntityLabel` owns for the name link,
 * because a chip that dropped them would be the drift that component exists to
 * prevent: no link on the connection's own page, `Unknown` for a connection that
 * did not resolve (full id still in `title`), and `System` for the all-zero
 * placeholder id (#2745), which is not a connection and has no page.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SYSTEM_CONNECTION_ID } from '../api/connections.types';

export interface ConnectionChipChannel {
  /** Drives the dot's hue via `data-channel`; an unknown value renders the neutral hue. */
  platformType: string | null | undefined;
  /** Registry-resolved display name of the platform. Without one, the chip shows the name. */
  label: string | null | undefined;
}

export interface ConnectionChipProps {
  connectionId: string;
  /** `null` = the page looked and the connection is unknown. */
  name: string | null;
  loading?: boolean;
  channel: ConnectionChipChannel;
  className?: string;
}

/**
 * The chip face carries the platform, not the adapter variant: a registry
 * display name such as `Subiekt GT (Sfera GT bridge)` names the bridge it is
 * reached through, which is detail for the tooltip rather than for a row.
 */
export function shortPlatformLabel(label: string): string {
  const short = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return short.length > 0 ? short : label;
}

export function ConnectionChip({
  connectionId,
  name,
  loading = false,
  channel,
  className = '',
}: ConnectionChipProps): ReactElement {
  const location = useLocation();
  const isSystem = connectionId === SYSTEM_CONNECTION_ID;
  const targetPath = `/connections/${connectionId}`;
  const linked = !isSystem && location.pathname !== targetPath;

  const label = channel.label ? channel.label : null;
  const resolvedName = isSystem ? 'System' : name;
  const unknown = resolvedName === null && !loading;
  const nameText = loading && !isSystem ? '…' : (resolvedName ?? 'Unknown');

  // An unresolved connection keeps its raw id reachable for a support ticket,
  // the same place `EntityLabel`'s Unknown branch puts it.
  const title = isSystem
    ? 'Not tied to a specific connection'
    : unknown
      ? connectionId
      : [resolvedName, label].filter(Boolean).join(' - ') || undefined;

  const classes = [
    'connection-chip',
    linked ? 'connection-chip--link' : null,
    label ? null : 'connection-chip--name-only',
    unknown ? 'connection-chip--unknown' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const nameNode = (
    <span className="connection-chip__name" aria-busy={loading && !isSystem ? true : undefined}>
      {nameText}
    </span>
  );

  const chevron = linked ? (
    <svg className="connection-chip__chevron" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M2.5 1.25 5.25 4 2.5 6.75" />
    </svg>
  ) : null;

  const body = label ? (
    <>
      <span className="connection-chip__face">
        <span className="connection-chip__dot" aria-hidden="true" />
        <span className="connection-chip__platform">{shortPlatformLabel(label)}</span>
      </span>
      {/* The name is always in the DOM - only its visibility is animated - so the
          link's text, and a screen reader's reading of it, never depend on hover. */}
      <span className="connection-chip__reveal">
        {nameNode}
        {chevron}
      </span>
    </>
  ) : (
    <span className="connection-chip__face">
      <span className="connection-chip__dot" aria-hidden="true" />
      {nameNode}
      {chevron}
    </span>
  );

  if (!linked) {
    return (
      <span className={classes} data-channel={channel.platformType ?? undefined} title={title}>
        {body}
      </span>
    );
  }

  return (
    <Link
      to={targetPath}
      className={classes}
      data-channel={channel.platformType ?? undefined}
      title={title}
      // Face and slide-out are adjacent inline boxes, so the computed name would
      // run them together ("AllegroAllegro (sandbox)"). Name first: it is what
      // tells two rows apart.
      aria-label={label ? `${nameText}, ${label}` : undefined}
    >
      {body}
    </Link>
  );
}
