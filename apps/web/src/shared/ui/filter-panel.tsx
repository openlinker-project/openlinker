/**
 * Filter Panel (#3507)
 *
 * The accordion body a `FilterToggleButton` discloses: a labelled region
 * holding up to four `FilterGroup` columns (two per row below 1280 px) and an
 * optional footer. There is no Apply button by design — every control inside
 * writes its value immediately, so the panel only ORGANISES controls and
 * never holds state of its own.
 *
 * - `FilterGroup` is a native `<fieldset>`/`<legend>`, so a screen reader
 *   announces "Shipment, group" on entry.
 * - `FilterField` is a label + control stack; pass `as="div"` when the control
 *   is a group (radios, a segmented control) that labels itself.
 * - `FilterRange` stacks a From / To pair under one field label.
 *
 * @module shared/ui
 */
import { forwardRef, type ReactElement, type ReactNode } from 'react';
import { FILTER_COPY } from './filter.copy';

export interface FilterPanelProps {
  id: string;
  /** Accessible name of the region; also the e2e anchor (`role=region name=Filters`). */
  label?: string;
  children: ReactNode;
  /** Footer content (hint + actions); omitted renders no footer bar. */
  footer?: ReactNode;
  className?: string;
}

export const FilterPanel = forwardRef<HTMLDivElement, FilterPanelProps>(function FilterPanel(
  { id, label = FILTER_COPY.panelLabel, children, footer, className = '' },
  ref,
): ReactElement {
  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label={label}
      className={['filter-panel', className].filter(Boolean).join(' ')}
    >
      <div className="filter-panel__grid">{children}</div>
      {footer ? <div className="filter-panel__footer">{footer}</div> : null}
    </div>
  );
});

export interface FilterPanelFooterProps {
  hint?: ReactNode;
  /** Right-aligned actions (e.g. "Clear all", "Hide filters"). */
  actions?: ReactNode;
}

/** The standard footer layout: a muted hint on the left, actions on the right. */
export function FilterPanelFooter({
  hint = FILTER_COPY.panelHint,
  actions,
}: FilterPanelFooterProps): ReactElement {
  return (
    <>
      {hint ? <span className="filter-panel__hint">{hint}</span> : null}
      {actions ? <span className="filter-panel__footer-end">{actions}</span> : null}
    </>
  );
}

export interface FilterGroupProps {
  legend: ReactNode;
  children: ReactNode;
}

export function FilterGroup({ legend, children }: FilterGroupProps): ReactElement {
  return (
    <fieldset className="filter-group">
      <legend className="filter-group__legend">{legend}</legend>
      {children}
    </fieldset>
  );
}

export interface FilterFieldProps {
  label: ReactNode;
  children: ReactNode;
  /**
   * `label` (default) wraps a single native control so clicking the text
   * focuses it. `div` is for a control that labels itself (a radiogroup, a
   * `FilterRange`) — a `<label>` around several controls is invalid.
   */
  as?: 'label' | 'div';
}

export function FilterField({ label, children, as = 'label' }: FilterFieldProps): ReactElement {
  const content = (
    <>
      <span className="filter-field__label">{label}</span>
      {children}
    </>
  );
  return as === 'label' ? (
    <label className="filter-field">{content}</label>
  ) : (
    <div className="filter-field">{content}</div>
  );
}

export interface FilterRangeRow {
  label: ReactNode;
  control: ReactElement;
}

export function FilterRange({ rows }: { rows: readonly FilterRangeRow[] }): ReactElement {
  return (
    <div className="filter-range">
      {rows.map((row, index) => (
        <label key={index} className="filter-range__row">
          <span className="filter-range__label">{row.label}</span>
          {row.control}
        </label>
      ))}
    </div>
  );
}
