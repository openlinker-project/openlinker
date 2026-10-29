/**
 * BulkActionBar
 *
 * Sticky action bar surfaced when an operator has multi-selected items on a
 * list page (#739 Products list is the first consumer). Renders a leading
 * tabular count + label and a trailing actions slot. Hidden via
 * `aria-hidden` when `count === 0`; consumers can also conditionally render.
 *
 * Listed in `docs/frontend-ui-style-guide.md § Core Component Patterns`.
 *
 * @module apps/web/src/shared/ui
 */
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { useCopy } from '../i18n/use-copy';
import { useActiveLocale } from '../i18n/use-locale';
import { usePlural } from '../i18n/use-plural';
import { useFormat } from '../i18n/use-format';
import type { PluralForms } from '../i18n/copy.types';
import { uiCopy } from './ui.copy';

export interface BulkActionBarProps extends ComponentPropsWithoutRef<'div'> {
  /** Number currently selected. The bar is visually hidden when 0. */
  count: number;
  /** Singular form of the entity ("product", "row"). Defaults to "item". */
  itemNoun?: string;
  /**
   * Plural forms for the region's accessible name, e.g.
   * `{ one: '{n} order selected', other: '{n} orders selected' }`.
   */
  selectedLabel?: PluralForms;
  /** Optional hint shown next to the count (e.g. "Max 100 per batch"). */
  hint?: ReactNode;
  /** Trailing actions slot — typically a Clear ghost button + a primary CTA. */
  actions: ReactNode;
}

export const BulkActionBar = forwardRef<HTMLDivElement, BulkActionBarProps>(
  function BulkActionBar(
    { count, selectedLabel, itemNoun, hint, actions, className = '', ...rest },
    ref,
  ) {
    const visible = count > 0;
    const classes = [
      'bulk-action-bar',
      visible ? '' : 'bulk-action-bar--hidden',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const copy = useCopy(uiCopy).bulkActionBar;
    const plural = usePlural();
    const { number } = useFormat();
    const locale = useActiveLocale();
    // `itemNoun` is the pre-i18n English API; callers move to `selectedLabel`
    // as their feature is extracted (#3868 onwards). It is English-only, so
    // any other language uses the generic count instead.
    const regionLabel =
      itemNoun && locale === 'en'
        ? `${number(count)} ${count === 1 ? itemNoun : `${itemNoun}s`} selected`
        : plural(count, selectedLabel ?? copy.selectedCount);

    return (
      <div
        ref={ref}
        className={classes}
        role="region"
        aria-label={visible ? regionLabel : undefined}
        aria-hidden={!visible}
        {...rest}
      >
        <div className="bulk-action-bar__count">
          <strong className="bulk-action-bar__num tabular" aria-live="polite">
            {number(count)}
          </strong>
          <span className="bulk-action-bar__label">{plural(count, copy.selected)}</span>
        </div>
        {hint !== undefined && hint !== null ? (
          <div className="bulk-action-bar__hint">{hint}</div>
        ) : null}
        <div className="bulk-action-bar__actions">{actions}</div>
      </div>
    );
  },
);
