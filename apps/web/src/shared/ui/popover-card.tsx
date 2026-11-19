/**
 * PopoverCard
 *
 * The content of an explanation popover: a tinted icon tile and a title, one
 * sentence that gives the verdict, a short list of the details, and a footer
 * strip for the trade-off or the upside. It carries no behaviour; it is what
 * `IconWithOnHoverPopoverTooltip` puts inside `PopoverOnHover`.
 *
 * The tone only recolours the tile and the list markers, so a warning and a
 * piece of background information share one shape and read as the same kind of
 * object.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export type PopoverCardTone = 'warning' | 'error' | 'info' | 'neutral';

export interface PopoverCardProps {
  /** Glyph for the tile beside the title, e.g. `<WarningIcon />`. */
  icon: ReactElement;
  title: string;
  /** One sentence: what this is about, before the details. */
  summary?: ReactNode;
  /** The details, one short line each. */
  items?: readonly ReactNode[];
  /** The trade-off or the upside, set apart from the details. */
  footer?: ReactNode;
  tone?: PopoverCardTone;
}

export function PopoverCard({
  icon,
  title,
  summary,
  items,
  footer,
  tone = 'neutral',
}: PopoverCardProps): ReactElement {
  return (
    <div className={`popover-card popover-card--${tone}`}>
      <div className="popover-card__head">
        <span className="popover-card__tile" aria-hidden="true">
          {icon}
        </span>
        <p className="popover-card__title">{title}</p>
      </div>
      {summary ? <p className="popover-card__summary">{summary}</p> : null}
      {items && items.length > 0 ? (
        <ul className="popover-card__list">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : null}
      {footer ? <p className="popover-card__footer">{footer}</p> : null}
    </div>
  );
}
