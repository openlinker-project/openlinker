/**
 * DescribedSelect (#3935)
 *
 * A choice from a short list where every option explains itself: an icon, a
 * title, one line saying what it does and a check on the chosen one. The panel
 * is the language switch's own (`MotionPopover` + `OptionList`), so it opens
 * with the same motion, moves with the keyboard the same way and renders into
 * a `<dialog>` when it sits inside one. The trigger shows the chosen option in
 * full, not only its title, so the form says what is currently decided without
 * opening anything.
 *
 * An option can be disabled with its reason shown in place of its description,
 * so a choice that is not available is still listed and explained.
 *
 * @module shared/ui
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { MotionPopover, useAnchoredPopover } from './motion-popover';
import { OptionList, type OptionListItem } from './option-list';

export interface DescribedSelectOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown instead of the description while disabled. */
  disabledReason?: ReactNode;
}

export interface DescribedSelectProps<T extends string> {
  options: readonly DescribedSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the control (the visible label sits outside). */
  'aria-label': string;
  disabled?: boolean;
  placement?: 'up' | 'down';
  width?: number;
  className?: string;
  'data-testid'?: string;
}

export function DescribedSelect<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  placement = 'down',
  width = 360,
  className,
  'data-testid': testId,
}: DescribedSelectProps<T>): ReactElement {
  const popover = useAnchoredPopover({ width, placement });
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  const items: OptionListItem<T>[] = options.map((option) => ({
    value: option.value,
    label: option.title,
    icon: option.icon,
    meta: option.disabled === true ? (option.disabledReason ?? option.description) : option.description,
  }));

  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        className={['described-select', className].filter(Boolean).join(' ')}
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-controls={popover.open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
        onClick={popover.toggle}
      >
        {current?.icon ? <span className="described-select__icon">{current.icon}</span> : null}
        <span className="described-select__text">
          <span className="described-select__title">{current?.title}</span>
          {current?.description ? (
            <span className="described-select__desc">{current.description}</span>
          ) : null}
        </span>
        <svg className="described-select__caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      <MotionPopover
        ref={popover.popoverRef}
        open={popover.open}
        position={popover.position}
        host={popover.host}
        placement={placement}
        width={width}
        className="described-select__popover"
      >
        <OptionList
          id={listId}
          className="option-list--described"
          options={items}
          value={value}
          showCheck
          aria-label={ariaLabel}
          onSelect={(next) => {
            const chosen = options.find((option) => option.value === next);
            if (chosen?.disabled === true) return;
            onChange(next);
            popover.close();
          }}
          onDismiss={popover.close}
        />
      </MotionPopover>
    </>
  );
}
