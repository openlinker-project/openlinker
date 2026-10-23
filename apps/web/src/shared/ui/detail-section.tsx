/**
 * DetailSection
 *
 * One card on a detail page: a bordered, raised surface with an optional small
 * muted title. It is the box model of the reviewed detail mockups
 * (`docs/plans/mockups/fulfillment-work-detail-3096.html`, `.detail-section`):
 * `--border-default`, `--radius-lg`, `--shadow-xs`, `--bg-surface`, 20 px by
 * 24 px of padding, and a 12 px / 700 uppercase title in `--text-muted`.
 *
 * ## Why a primitive rather than a class on each page
 *
 * Detail pages kept re-deriving this shape by hand, and the ones that did not
 * shipped their sections as flat blocks on the page background - the single
 * biggest reason a page read as a sketch beside its mockup. One component
 * means one box model, and spacing BETWEEN cards is left to the parent stack's
 * `gap` so a card never carries an outer margin that a sibling has to undo.
 *
 * ## Not `.detail-section`
 *
 * The order-detail page already uses `.detail-section` as an unstyled grid
 * wrapper with a 15 px title, and dozens of call sites rely on it staying
 * unboxed. The card therefore lives on its own `.detail-card` block instead of
 * silently restyling every one of them.
 *
 * `tone` exists for the two variants the mockups draw with their own padding:
 * the hero (22 px by 24 px) and the action bar (18 px by 24 px).
 *
 * @module shared/ui
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type DetailSectionTone = 'default' | 'hero' | 'actions';

export interface DetailSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The small muted heading. Omit for a card that carries its own heading. */
  title?: ReactNode;
  /** Trailing content on the title row - a count, a link, a small action. */
  titleAside?: ReactNode;
  tone?: DetailSectionTone;
  children: ReactNode;
}

const TONE_CLASS: Record<DetailSectionTone, string> = {
  default: '',
  hero: 'detail-card--hero',
  actions: 'detail-card--actions',
};

export const DetailSection = forwardRef<HTMLElement, DetailSectionProps>(function DetailSection(
  { title, titleAside, tone = 'default', className = '', children, ...rest },
  ref
) {
  const classes = ['detail-card', TONE_CLASS[tone], className].filter(Boolean).join(' ');

  return (
    <section ref={ref} className={classes} {...rest}>
      {title !== undefined || titleAside !== undefined ? (
        <div className="detail-card__head">
          {title !== undefined ? <h3 className="detail-card__title">{title}</h3> : null}
          {titleAside !== undefined ? (
            <div className="detail-card__aside">{titleAside}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
});
