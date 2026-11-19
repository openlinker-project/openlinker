/**
 * Order Sync Start Field
 *
 * The "which orders should we import first?" choice (#4228): three radio
 * cards, a date input when the operator picks a start day, and the
 * consequence of the choice stated right under the cards. Cards the source
 * cannot do stay visible and disabled with the reason, so the operator sees
 * the option exists instead of wondering why it is missing.
 *
 * @module features/connections/components
 */
import { useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { WarningPopoverTooltip } from '../../../shared/ui/warning-popover-tooltip';
import type { OrderSyncStartMode } from '../api/connections.types';
import {
  earliestOrderSyncStartDate,
  latestOrderSyncStartDate,
  type OrderSyncStartValue,
} from '../lib/order-sync-start';

const MODES: readonly OrderSyncStartMode[] = ['now', 'from', 'all'];

interface OrderSyncStartFieldProps {
  value: OrderSyncStartValue;
  onChange: (value: OrderSyncStartValue) => void;
  supportedModes: readonly OrderSyncStartMode[];
  /** Message for the date input, when the chosen date is not acceptable. */
  error?: string;
  /** Restarting an existing connection: the intro must not claim the choice is final. */
  restart?: boolean;
}

export function OrderSyncStartField({
  value,
  onChange,
  supportedModes,
  error,
  restart = false,
}: OrderSyncStartFieldProps): ReactElement {
  const copy = useMessages('connections').orderSyncStart;
  const format = useFormat();
  const groupId = useId();
  const cardRefs = useRef<Partial<Record<OrderSyncStartMode, HTMLDivElement | null>>>({});

  const enabledModes = MODES.filter((mode) => supportedModes.includes(mode));
  // Roving tabindex: the checked card is the tab stop, or the first one that can be chosen.
  const tabStop = enabledModes.includes(value.mode) ? value.mode : enabledModes[0];

  function select(mode: OrderSyncStartMode): void {
    if (!supportedModes.includes(mode) || mode === value.mode) return;
    onChange(mode === 'from' ? { mode, from: value.from ?? '' } : { mode });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, mode: OrderSyncStartMode): void {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      select(mode);
      return;
    }
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const index = enabledModes.indexOf(mode);
    if (index < 0) return;
    const next = enabledModes[(index + (forward ? 1 : -1) + enabledModes.length) % enabledModes.length];
    select(next);
    cardRefs.current[next]?.focus();
  }

  const from = value.from ?? '';
  const dateIsUsable = value.mode === 'from' && from !== '' && !error;

  return (
    <div className="order-sync-start">
      {restart ? null : (
        <div className="order-sync-start__intro">
          <h3 className="order-sync-start__title">{copy.title}</h3>
          <p className="muted-text">{copy.intro}</p>
        </div>
      )}

      <div
        className="order-sync-start__cards"
        role="radiogroup"
        aria-label={copy.title}
        id={groupId}
      >
        {MODES.map((mode) => {
          const disabled = !supportedModes.includes(mode);
          const checked = value.mode === mode;
          const descriptionId = `${groupId}-${mode}`;
          const card = copy.modes[mode];
          return (
            <div
              key={mode}
              ref={(node) => {
                cardRefs.current[mode] = node;
              }}
              role="radio"
              aria-checked={checked}
              aria-disabled={disabled || undefined}
              aria-describedby={descriptionId}
              tabIndex={disabled ? -1 : tabStop === mode ? 0 : -1}
              className={[
                'platform-picker__card',
                'order-sync-start__card',
                checked ? 'order-sync-start__card--checked' : '',
                disabled ? 'order-sync-start__card--disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => select(mode)}
              onKeyDown={(event) => handleKeyDown(event, mode)}
            >
              <div className="platform-picker__card-header">
                <h4 className="platform-picker__card-title">{card.title}</h4>
                {mode === 'all' && !disabled ? (
                  // The icon sits inside a card that selects on click and on Enter/Space;
                  // the icon has its own Enter/Space (it opens the panel), so the card must
                  // not also hear them.
                  <span onKeyDown={(event) => event.stopPropagation()}>
                    <WarningPopoverTooltip
                      label={copy.all.warningLabel}
                      align="end"
                      width={340}
                    >
                      <p className="popover-on-hover__title">{copy.all.warningTitle}</p>
                      <ul className="popover-on-hover__list">
                        <li>{copy.all.orders}</li>
                        <li>{copy.all.documents}</li>
                        <li>{copy.all.stock}</li>
                        <li>{copy.all.delay}</li>
                      </ul>
                    </WarningPopoverTooltip>
                  </span>
                ) : null}
              </div>
              <p id={descriptionId} className="platform-picker__card-description">
                {card.description}
                {disabled ? (
                  <span className="order-sync-start__reason"> {copy.unsupported[mode]}</span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>

      <div className="order-sync-start__reveal" key={value.mode}>
        {value.mode === 'from' ? (
          <FormField label={copy.dateLabel} name="orderSyncStartFrom" error={error}>
            <Input
              type="date"
              value={from}
              min={earliestOrderSyncStartDate()}
              max={latestOrderSyncStartDate()}
              invalid={Boolean(error)}
              onChange={(event) => onChange({ mode: 'from', from: event.target.value })}
            />
          </FormField>
        ) : null}

        {value.mode === 'now' ? <p className="order-sync-start__note">{copy.info.now}</p> : null}

        {dateIsUsable ? (
          <p className="order-sync-start__note">
            {interpolate(copy.info.from, { date: format.date(`${from}T12:00:00`) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
