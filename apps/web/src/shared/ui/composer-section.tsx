/**
 * ComposerSection
 *
 * One card of a composer form: optional step number, title and a mono aside on
 * the header line, then the body. Reuses the `rule-composer-section` card
 * chrome so every composer (rules, bundles, promotions) reads alike.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface ComposerSectionProps {
  step?: string;
  title: ReactNode;
  aside?: ReactNode;
  /** Order for the staggered entrance, 0-based. */
  riseIndex?: number;
  id?: string;
  hidden?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}

export function ComposerSection({
  step,
  title,
  aside,
  riseIndex = 0,
  id,
  hidden,
  children,
  'data-testid': testId,
}: ComposerSectionProps): ReactElement | null {
  if (hidden) return null;
  return (
    <section
      id={id}
      className="rule-composer-section pm-rise"
      style={{ ['--rise-i' as string]: riseIndex }}
      data-testid={testId}
    >
      <div className="pm-card__head">
        <h2 className="pm-card__t">
          {step ? <span className="pm-card__step">{step}</span> : null}
          {title}
        </h2>
        {aside ? <span className="pm-card__aside pm-card__aside--plain">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}
