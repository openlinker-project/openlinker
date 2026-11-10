/**
 * ComposerSection (#3935)
 *
 * One numbered card of a form that composes a rule: a step number, a title, a
 * short aside on the right that says what the card currently holds, and the
 * card's fields. The aside is the card's one-glance summary, so an operator
 * scanning a long form can read the state without opening anything.
 *
 * @module shared/ui
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';

export interface ComposerSectionProps {
  /** "01". Omit for a card with no step number (the rail cards). */
  step?: string;
  title?: ReactNode;
  /** What the card holds right now, e.g. "2 of 4". */
  aside?: ReactNode;
  /** Draw the aside in the mono caps style (a status line) instead of plain text. */
  asideCaps?: boolean;
  /** Entrance order for the page's staggered rise. */
  riseIndex?: number;
  id?: string;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function ComposerSection({
  step,
  title,
  aside,
  asideCaps = false,
  riseIndex,
  id,
  children,
  className,
  'data-testid': testId,
}: ComposerSectionProps): ReactElement {
  const style =
    riseIndex === undefined ? undefined : ({ '--rise-i': riseIndex } as CSSProperties);
  return (
    <section
      className={['rule-composer-section', riseIndex !== undefined ? 'pm-rise' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      id={id}
      data-testid={testId}
    >
      {title === undefined && aside === undefined ? null : (
      <div className="pm-card__head">
        <h2 className="pm-card__t">
          {step !== undefined ? <span className="pm-card__step">{step}</span> : null}
          {title}
        </h2>
        {aside !== undefined ? (
          <span className={['pm-card__aside', asideCaps ? '' : 'pm-card__aside--plain'].filter(Boolean).join(' ')}>
            {aside}
          </span>
        ) : null}
      </div>
      )}
      {children}
    </section>
  );
}
