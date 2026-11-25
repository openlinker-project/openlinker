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
import { IconWithOnHoverPopoverTooltip } from '../../../shared/ui/icon-with-popover-tooltip';
import { InfoIcon, WarningIcon } from '../../../shared/ui/icons';
import { PopoverCard } from '../../../shared/ui/popover-card';
import type { OrderImportOrder, OrderSyncStartMode } from '../api/connections.types';
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
  /** The source can import history newest-first (`orderWindowImport` in its manifest). */
  windowImport?: boolean;
  /** `system` words the cards for an ERP such as Subiekt, which is not a shop. */
  sourceKind?: OrderSyncSourceKind;
  /** One-page forms: set the section apart from the credential fields above it. */
  separated?: boolean;
}

export type OrderSyncSourceKind = 'shop' | 'system';

export function OrderSyncStartField({
  value,
  onChange,
  supportedModes,
  error,
  restart = false,
  windowImport = false,
  sourceKind = 'shop',
  separated = false,
}: OrderSyncStartFieldProps): ReactElement {
  const copy = useMessages('connections').orderSyncStart;
  const format = useFormat();
  const groupId = useId();
  const titleId = `${groupId}-title`;
  const cardRefs = useRef<Partial<Record<OrderSyncStartMode, HTMLDivElement | null>>>({});
  const orderRefs = useRef<Partial<Record<OrderImportOrder, HTMLDivElement | null>>>({});

  const enabledModes = MODES.filter((mode) => supportedModes.includes(mode));
  // Roving tabindex: the checked card is the tab stop, or the first one that can be chosen.
  const tabStop = enabledModes.includes(value.mode) ? value.mode : enabledModes[0];

  function select(mode: OrderSyncStartMode): void {
    if (!supportedModes.includes(mode) || mode === value.mode) return;
    const order = value.order === 'newest-first' ? { order: value.order } : {};
    if (mode === 'now') onChange({ mode });
    else if (mode === 'from') onChange({ mode, from: value.from ?? '', ...order });
    else onChange({ mode, ...order });
  }

  function selectOrder(order: OrderImportOrder): void {
    if (value.mode === 'now' || (order === 'newest-first' && !windowImport)) return;
    if (order === (value.order ?? 'oldest-first')) return;
    onChange({ ...value, order });
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
    const next =
      enabledModes[(index + (forward ? 1 : -1) + enabledModes.length) % enabledModes.length];
    select(next);
    cardRefs.current[next]?.focus();
  }

  const from = value.from ?? '';
  const dateIsUsable = value.mode === 'from' && from !== '' && !error;

  return (
    <div className={separated ? 'order-sync-start order-sync-start--separated' : 'order-sync-start'}>
      {restart ? null : (
        <div className="order-sync-start__intro">
          <h3 className="order-sync-start__title" id={titleId}>
            {copy.title}
          </h3>
          <p className="order-sync-start__helper">{copy.intro}</p>
        </div>
      )}

      <div
        className="order-sync-start__cards"
        role="radiogroup"
        aria-label={restart ? copy.title : undefined}
        aria-labelledby={restart ? undefined : titleId}
        id={groupId}
      >
        {MODES.map((mode) => {
          const disabled = !supportedModes.includes(mode);
          const checked = value.mode === mode;
          const descriptionId = `${groupId}-${mode}`;
          const base = copy.modes[mode];
          const systemCard =
            sourceKind === 'system'
              ? (copy.system.modes as Partial<Record<OrderSyncStartMode, Partial<typeof base>>>)[mode]
              : undefined;
          const card = { ...base, ...systemCard };
          const warningId = `${descriptionId}-warning`;
          return (
            <div key={mode} className="order-sync-start__option">
              <div
                ref={(node) => {
                  cardRefs.current[mode] = node;
                }}
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                aria-describedby={
                  mode === 'all' && !disabled ? `${descriptionId} ${warningId}` : descriptionId
                }
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
                <div className="platform-picker__card-header order-sync-start__card-header">
                  <span className="order-sync-start__dot" aria-hidden="true" />
                  <h4 className="platform-picker__card-title">{card.title}</h4>
                  {mode === 'now' && !disabled ? (
                    <span className="order-sync-start__badge">{copy.recommended}</span>
                  ) : null}
                </div>
                <p id={descriptionId} className="platform-picker__card-description">
                  {card.description}
                  {disabled ? (
                    <span className="order-sync-start__reason"> {copy.unsupported[mode]}</span>
                  ) : null}
                </p>
                {mode === 'all' && !disabled ? (
                  <p id={warningId} className="order-sync-start__warning">
                    <WarningIcon />
                    <span>{copy.all.longWarning}</span>
                  </p>
                ) : null}
              </div>
              {!disabled && (mode === 'now' || mode === 'all') ? (
                <span className="order-sync-start__tip">
                  {mode === 'all' ? (
                    <IconWithOnHoverPopoverTooltip
                      icon={<WarningIcon />}
                      tone="warning"
                      label={copy.all.warningLabel}
                      align="end"
                      width={360}
                    >
                      <PopoverCard
                        tone="warning"
                        icon={<WarningIcon />}
                        title={copy.all.warningTitle}
                        summary={sourceKind === 'system' ? copy.system.all.summary : copy.all.summary}
                        items={[
                          copy.all.orders,
                          copy.all.documents,
                          copy.all.stock,
                          copy.all.delay,
                        ]}
                        footer={copy.all.analytics}
                      />
                    </IconWithOnHoverPopoverTooltip>
                  ) : (
                    <IconWithOnHoverPopoverTooltip
                      icon={<InfoIcon />}
                      tone="info"
                      label={copy.now.infoLabel}
                      align="end"
                      width={340}
                    >
                      <PopoverCard
                        tone="info"
                        icon={<InfoIcon />}
                        title={copy.now.infoTitle}
                        summary={copy.now.summary}
                        items={[copy.now.noFlood, copy.now.noQueue, copy.now.noStock]}
                        footer={copy.now.analytics}
                      />
                    </IconWithOnHoverPopoverTooltip>
                  )}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {value.mode !== 'now' ? (
        <div className="order-sync-start__order">
          <p className="order-sync-start__order-title" id={`${groupId}-order`}>
            {copy.order.title}
          </p>
          <div
            className="order-sync-start__order-options"
            role="radiogroup"
            aria-labelledby={`${groupId}-order`}
          >
            {(['oldest-first', 'newest-first'] as const).map((order) => {
              const unavailable = order === 'newest-first' && !windowImport;
              const checked = (value.order ?? 'oldest-first') === order;
              return (
                <div
                  key={order}
                  ref={(node) => {
                    orderRefs.current[order] = node;
                  }}
                  role="radio"
                  tabIndex={unavailable ? -1 : checked ? 0 : -1}
                  aria-checked={checked}
                  aria-disabled={unavailable || undefined}
                  className={[
                    'order-sync-start__order-option',
                    checked ? 'order-sync-start__order-option--checked' : '',
                    unavailable ? 'order-sync-start__order-option--disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectOrder(order)}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault();
                      selectOrder(order);
                    } else if (
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowLeft' ||
                      event.key === 'ArrowDown' ||
                      event.key === 'ArrowUp'
                    ) {
                      event.preventDefault();
                      const next = order === 'oldest-first' ? 'newest-first' : 'oldest-first';
                      if (next === 'newest-first' && !windowImport) return;
                      selectOrder(next);
                      // The checked option is the tab stop, so focus must follow the choice.
                      orderRefs.current[next]?.focus();
                    }
                  }}
                >
                  <span className="order-sync-start__order-label">{copy.order[order].title}</span>
                  <span className="order-sync-start__order-text">
                    {unavailable ? copy.order.unsupported : copy.order[order].description}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="order-sync-start__reveal" key={value.mode}>
        {value.mode === 'from' ? (
          <FormField label={copy.dateLabel} name="orderSyncStartFrom" error={error}>
            <Input
              type="date"
              value={from}
              min={earliestOrderSyncStartDate()}
              max={latestOrderSyncStartDate()}
              invalid={Boolean(error)}
              onChange={(event) => onChange({ ...value, mode: 'from', from: event.target.value })}
            />
          </FormField>
        ) : null}

        {value.mode === 'now' && !restart ? (
          <p className="order-sync-start__note">{copy.info.now}</p>
        ) : null}

        {dateIsUsable ? (
          <p className="order-sync-start__note">
            {interpolate(copy.info.from, { date: format.date(`${from}T12:00:00`) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
