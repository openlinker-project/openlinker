/**
 * ConnectionChip — a connection's channel as one clickable chip (#3670).
 *
 * Before this, a list showed a non-clickable `.channel-pill` beside a separate,
 * usually truncated name link: the large recognisable element did nothing and
 * the clickable one was a fragment. The chip is now the link.
 *
 * At rest it shows the connection name the operator chose (`e-box`) - plus a
 * `sandbox` tag for a sandbox connection, so it never reads the same as its
 * production twin - and the integration (`Shoper`, `Allegro (sandbox)`) slides
 * out to the right on hover or keyboard focus (#4232). A surface that already
 * prints the name beside the chip (the Insights health tables) passes
 * `lead="platform"` to keep the platform on the face instead.
 * The slide-out is absolutely positioned so the row never reflows, and on a
 * device with no hover it is rendered statically instead, because a name that
 * only appears on hover would otherwise never appear there at all.
 *
 * System / Unknown / self-page are decided by `resolveConnectionLinkTarget`,
 * the same resolver `ConnectionEntityLabel` renders from, so the chip and the
 * name link cannot drift apart.
 *
 * @module features/connections/components
 */
import { interpolate, useMessages } from '../../../shared/i18n';
import type { FocusEvent, PointerEvent, ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ConnectionEnvironment } from '../lib/connection-environment';
import { resolveConnectionLinkTarget } from '../lib/connection-link-target';

export interface ConnectionChipChannel {
  /** Drives the dot's hue via `data-channel`; an unknown value renders the neutral hue. */
  platformType: string | null | undefined;
  /** Registry-resolved display name of the platform. Without one, the chip shows the name. */
  label: string | null | undefined;
  /**
   * Registry-declared compact label for the face (`resolvePlatformShortLabel`);
   * falls back to `label`. The full `label` stays in the tooltip and accessible name.
   */
  shortLabel?: string | null;
  /**
   * The connection's environment (`readConnectionEnvironment`). A sandbox
   * connection says so on the face: the chip is what an operator scans, and a
   * sandbox and a production connection of one platform share both the label
   * and the dot hue.
   */
  environment?: ConnectionEnvironment | null;
}

export interface ConnectionChipProps {
  connectionId: string;
  /** `null` = the page looked and the connection is unknown. */
  name: string | null;
  loading?: boolean;
  channel: ConnectionChipChannel;
  /**
   * What the face leads with. `name` (default) shows the connection name and
   * slides the integration out; `platform` is the pre-#4232 layout, for a
   * surface that already prints the name next to the chip and would otherwise
   * show it twice.
   */
  lead?: 'name' | 'platform';
  /**
   * Renders the face alone, as a plain element: no link, nothing that slides
   * out on hover or focus, and the same width at rest and under the pointer.
   * For a host that is itself the control (a tab) and so cannot nest a link.
   */
  static?: boolean;
  /** Link to this path instead of the connection's detail page (a host's own view of it). */
  to?: string;
  /** Called when a linked chip is followed, before the navigation. */
  onNavigate?: () => void;
  /** Accessible name of a linked chip; defaults to "name, platform". */
  linkLabel?: string;
  className?: string;
  /**
   * Lay the slide-out on the viewport instead of inside the chip. For a chip
   * inside a container that clips its overflow (a collapsing card), where the
   * absolutely positioned slide-out is cut off. It opens to the right, or to
   * the left when the right edge of the screen would cut it.
   */
  floatReveal?: boolean;
}

/** Places the floating slide-out beside the face, on whichever side fits the screen. */
function placeFloatingReveal(chip: HTMLElement): void {
  const face = chip.querySelector<HTMLElement>('.connection-chip__face');
  const reveal = chip.querySelector<HTMLElement>('.connection-chip__reveal');
  if (!face || !reveal) return;
  const rect = face.getBoundingClientRect();
  const width = reveal.offsetWidth;
  const overlap = 12;
  const margin = 8;
  const fitsRight = rect.right - overlap + width <= window.innerWidth - margin;
  chip.dataset.side = fitsRight ? 'right' : 'left';
  const x = fitsRight ? rect.right - overlap : Math.max(margin, rect.left + overlap - width);
  chip.style.setProperty('--reveal-x', `${x}px`);
  chip.style.setProperty('--reveal-y', `${rect.top}px`);
}

export function ConnectionChip({
  connectionId,
  name,
  loading = false,
  channel,
  lead = 'name',
  static: staticFace = false,
  to,
  onNavigate,
  linkLabel,
  className = '',
  floatReveal = false,
}: ConnectionChipProps): ReactElement {
  const copy = useMessages('connections').connectionChip;
  const location = useLocation();
  const target = resolveConnectionLinkTarget({
    connectionId,
    name,
    loading,
    pathname: location.pathname,
  });
  const { unknown, text: nameText } = target;
  const linked = !staticFace && (to !== undefined ? !target.system && !target.loading && !unknown : target.linked);

  // Only sandbox is marked: production is the norm, and a suffix on every
  // production row would be noise that hides the one row that differs.
  const sandbox = channel.environment === 'sandbox';
  const platformLabel = channel.label || null;
  const label =
    platformLabel && sandbox
      ? interpolate(copy.sandboxLabel, { platform: platformLabel })
      : platformLabel;
  const shortPlatform = channel.shortLabel || platformLabel;
  const faceLabel = platformLabel
    ? sandbox
      ? interpolate(copy.sandboxFace, { platform: shortPlatform ?? platformLabel })
      : shortPlatform
    : null;

  // System and an unresolved connection carry the resolver's own tooltip (the
  // latter its raw id, for a support ticket); otherwise name and full platform.
  const title =
    target.title ??
    (target.displayName && label
      ? interpolate(copy.title, { name: target.displayName, platform: label })
      : target.displayName || label || undefined);

  // Without a platform label there is nothing to slide out: the name is the
  // face whichever way the chip leads.
  const nameFirst = lead === 'name' && faceLabel !== null;

  const classes = [
    'connection-chip',
    nameFirst ? 'connection-chip--name-first' : null,
    linked ? 'connection-chip--link' : null,
    label ? null : 'connection-chip--name-only',
    unknown ? 'connection-chip--unknown' : null,
    staticFace ? 'connection-chip--static' : null,
    floatReveal ? 'connection-chip--float' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const nameNode = (
    <span className="connection-chip__name" aria-busy={target.loading ? true : undefined}>
      {nameText}
    </span>
  );

  const chevron = linked ? (
    <svg className="connection-chip__chevron" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M2.5 1.25 5.25 4 2.5 6.75" />
    </svg>
  ) : null;

  const body = staticFace ? (
    <span className="connection-chip__face">
      <span className="connection-chip__dot" aria-hidden="true" />
      <span className="connection-chip__label" aria-busy={target.loading ? true : undefined}>
        {nameText}
      </span>
      {sandbox ? <span className="connection-chip__env">{copy.sandboxTag}</span> : null}
    </span>
  ) : nameFirst ? (
    <>
      <span className="connection-chip__face">
        <span className="connection-chip__dot" aria-hidden="true" />
        <span className="connection-chip__label" aria-busy={target.loading ? true : undefined}>
          {nameText}
        </span>
        {sandbox ? <span className="connection-chip__env">{copy.sandboxTag}</span> : null}
      </span>
      {/* The integration is always in the DOM - only its visibility is animated -
          so the link's text, and a screen reader's reading of it, never depend on hover. */}
      <span className="connection-chip__reveal">
        <span className="connection-chip__name">
          {sandbox
            ? interpolate(copy.sandboxLabel, { platform: shortPlatform ?? '' })
            : shortPlatform}
        </span>
        {chevron}
      </span>
    </>
  ) : faceLabel ? (
    <>
      <span className="connection-chip__face">
        <span className="connection-chip__dot" aria-hidden="true" />
        <span className="connection-chip__platform">{faceLabel}</span>
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

  const onFloatEnter = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>): void =>
    placeFloatingReveal(e.currentTarget);

  if (!linked) {
    return (
      <span className={classes} data-channel={channel.platformType ?? undefined} title={title}>
        {body}
      </span>
    );
  }

  return (
    <Link
      to={to ?? target.targetPath}
      onClick={onNavigate}
      className={classes}
      data-channel={channel.platformType ?? undefined}
      title={title}
      onPointerEnter={floatReveal ? onFloatEnter : undefined}
      onFocus={floatReveal ? onFloatEnter : undefined}
      // Face and slide-out are adjacent inline boxes, so the computed name would
      // run them together ("e-boxShoper"). Name first: it is what tells two rows
      // apart.
      aria-label={
        linkLabel ??
        (label ? interpolate(copy.ariaLabel, { name: nameText, platform: label }) : undefined)
      }
    >
      {body}
    </Link>
  );
}
