/**
 * AttentionSummary (#4026, shared by #4027)
 *
 * "Needs a look" as one quiet line beside a list's status tabs:
 *
 *   Needs a look  6 late to ship · 7 stuck · 3 to handle
 *
 * Each group shows ONE number and opens a popover. A group either lists
 * toggleable filter items (each with a one-line explanation, its own count and,
 * where known, the age of the oldest item) or carries a free-form `body` (a
 * sentence and a link). The caller owns the numbers and what a toggle writes;
 * an unknown number reads as a dash, never as 0.
 *
 * @module shared/ui
 */
import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../i18n/use-messages';
import { usePlural } from '../i18n/use-plural';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type AttentionTone = 'error' | 'warning';

export interface AttentionItem {
  id: string;
  label: string;
  desc: string;
  tone?: AttentionTone | null;
  on: boolean;
  count: number | undefined;
  /** Already formatted, e.g. "oldest 11 d"; shown only when the count is non-zero. */
  age?: string;
  title?: string;
  toggle: () => void;
}

export interface AttentionGroup {
  id: string;
  label: string;
  /** The lower-case phrase after the number: "late to ship". */
  short: string;
  tone?: AttentionTone | null;
  total: number | undefined;
  items?: readonly AttentionItem[];
  /** Free-form popover content instead of items. Receives a close callback. */
  body?: (close: () => void) => ReactNode;
  footer?: ReactNode;
}

export interface AttentionSummaryProps {
  groups: readonly AttentionGroup[];
  label: string;
}

export function AttentionSummary({ groups, label }: AttentionSummaryProps): ReactElement {
  return (
    <div className="attention-summary" role="group" aria-label={label}>
      <span className="attention-summary__label">{label}</span>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? (
            <span className="attention-summary__sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          <AttentionGroupLink group={group} />
        </Fragment>
      ))}
    </div>
  );
}

function AttentionGroupLink({ group }: { group: AttentionGroup }): ReactElement {
  const copy = useMessages('ui').attentionSummary;
  const plural = usePlural();
  const [open, setOpen] = useState(false);
  const activeCount = (group.items ?? []).filter((item) => item.on).length;
  const classes = [
    'attention-summary__link',
    group.total && group.tone ? `attention-summary__link--${group.tone}` : '',
    activeCount > 0 ? 'attention-summary__link--on' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const activeLabel = activeCount > 0 ? plural(activeCount, copy.filtersOn) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={classes} data-attention-group={group.id}>
          <span className="attention-summary__n mono tabular">
            {group.total === undefined ? copy.unknownCount : group.total}
          </span>
          <span className="attention-summary__short">{group.short}</span>
          {activeLabel ? (
            <span className="attention-summary__on" title={activeLabel} aria-label={activeLabel} />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="attention-pop" aria-label={group.label}>
        <div className="attention-pop__head">{group.label}</div>
        {group.body
          ? group.body(() => {
              setOpen(false);
            })
          : null}
        {(group.items ?? []).map((item) => {
          const countClass = [
            'attention-item__n',
            'mono',
            'tabular',
            item.count && item.tone ? `attention-item__n--${item.tone}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={item.id}
              type="button"
              className="attention-item"
              aria-pressed={item.on}
              title={item.title}
              data-attention-item={item.id}
              onClick={item.toggle}
            >
              <span className="attention-item__box" aria-hidden="true" />
              <span className="attention-item__text">
                <span className="attention-item__title">{item.label}</span>
                <span className="attention-item__desc">{item.desc}</span>
              </span>
              <span className="attention-item__meta">
                <span className={countClass}>{item.count === undefined ? copy.unknownCount : item.count}</span>
                {item.age && item.count ? <span className="attention-item__age mono">{item.age}</span> : null}
              </span>
            </button>
          );
        })}
        {group.footer ? <div className="attention-pop__foot">{group.footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}
