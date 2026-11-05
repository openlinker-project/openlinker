/**
 * GiftRuleComposer (#3940, mockup M31 `promotions/composer-*`)
 *
 * One form for the three kinds of promotion (a gift with a product, from an
 * order amount, for every unit). Four things are visible up front - when, the
 * gift, channels, period - and everything else is folded under "More options"
 * with a one-line summary of the defaults, because most promotions never touch
 * them. The cost line states what the customer pays (0.00) and what it costs the
 * seller, so a gift is never mistaken for free.
 *
 * Self-pause, limit, ended and "edited with open orders" are states of the SAME
 * form, shown as one notice above it, never as a separate screen.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useApiClient } from '../../../app/api/api-client-provider';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { BundleProductPicker, type BundleProductChoice } from '../../bundles';
import { useConnectionsQuery } from '../../connections';
import { GiftDocumentFormField } from '../../gift-documents';
import type { GiftRule } from '../api/gifts.types';
import {
  channelMarker,
  coversNativeChannel,
  orderSourceChannels,
} from '../lib/gift-channels';
import {
  formToWriteInput,
  suggestRuleName,
  validateGiftRuleForm,
  type GiftRuleFormValues,
  type PickedProduct,
} from '../lib/gift-rule-form';
import { isSelfPaused } from '../lib/gift-rule-view';
import { GiftRuleTestPanel } from './gift-rule-test-panel';

export interface GiftRuleComposerProps {
  initial: GiftRuleFormValues;
  /** The saved rule being edited; `null` for a new one. */
  rule: GiftRule | null;
  canWrite: boolean;
  saving: boolean;
  onSave: (values: GiftRuleFormValues, isActive: boolean, extend?: { to: string }) => void;
  onResume: (additionalUnits: number) => void;
  onCopy: () => void;
  saveError: string | null;
}

const toPicked = (choice: BundleProductChoice): PickedProduct => ({
  productId: choice.productId,
  variantId: choice.variantId,
  name: choice.name,
});

export function GiftRuleComposer({
  initial,
  rule,
  canWrite,
  saving,
  onSave,
  onResume,
  onCopy,
  saveError,
}: GiftRuleComposerProps): ReactElement {
  const copy = useMessages('gifts');
  const apiClient = useApiClient();
  const connections = useConnectionsQuery();
  const form = useForm<GiftRuleFormValues>({ defaultValues: initial });
  const values = form.watch();
  const [nameTouched, setNameTouched] = useState(initial.name !== '');
  const [moreOpen, setMoreOpen] = useState(false);
  const [extendTo, setExtendTo] = useState('');
  const [resumeUnits, setResumeUnits] = useState('50');

  const { reset } = form;
  useEffect(() => {
    reset(initial);
    setNameTouched(initial.name !== '');
  }, [initial, reset]);

  const channels = useMemo(() => orderSourceChannels(connections.data ?? []), [connections.data]);
  const problems = validateGiftRuleForm(values);
  const draft = problems.length === 0 ? formToWriteInput(values, true) : null;
  const disabled = !canWrite || saving;

  // The name follows what the operator picked until they type their own.
  const suggested = suggestRuleName(values, copy.composer.nameTemplates);
  useEffect(() => {
    if (!nameTouched && suggested !== '' && suggested !== values.name) {
      form.setValue('name', suggested);
    }
  }, [nameTouched, suggested, values.name, form]);

  const giftCost = useQuery({
    queryKey: ['gifts', 'variant-cost', values.gift?.productId ?? ''],
    queryFn: () => apiClient.products.getVariantCosts(values.gift?.productId ?? ''),
    enabled: values.gift !== null,
  });
  const unitCost =
    giftCost.data?.find((c) => c.variantId === values.gift?.variantId)?.netUnitCost ?? null;

  const state = rule === null ? 'new' : rule.status;
  const ended = rule?.status === 'ended';
  const selfPaused = rule !== null && isSelfPaused(rule);

  const moreSummary = [
    values.doNotCombine ? copy.composer.summary.noStack : copy.composer.summary.combines,
    values.unitCap.trim() === ''
      ? copy.composer.summary.noCap
      : interpolate(copy.composer.summary.cap, { n: values.unitCap }),
    copy.composer.summary.pauses,
  ].join(', ');

  const toggleChannel = (id: string): void => {
    const current = values.channelIds;
    form.setValue(
      'channelIds',
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  const problemText = (key: (typeof problems)[number]): string => copy.composer.problems[key];

  return (
    <div className="gift-composer" data-testid="gift-composer">
      {!canWrite ? (
        <Alert tone="info" data-testid="gift-rule-readonly-notice">
          {copy.list.readOnly}
        </Alert>
      ) : null}

      {selfPaused && rule !== null ? (
        <Alert
          tone="warning"
          title={
            rule.pausedReason === 'unit-cap' ? copy.composer.limitTitle : copy.composer.pausedStockTitle
          }
          data-testid="gift-composer-selfpause-alert"
          action={
            rule.pausedReason === 'unit-cap' && canWrite ? (
              <span className="gift-composer__resume">
                <Input
                  type="number"
                  min={1}
                  aria-label={copy.composer.resumeUnits}
                  value={resumeUnits}
                  onChange={(event) => setResumeUnits(event.target.value)}
                  data-testid="gift-composer-resume-units"
                />
                <Button
                  disabled={saving || !(Number(resumeUnits) > 0)}
                  onClick={() => onResume(Number(resumeUnits))}
                  data-testid="gift-composer-resume"
                >
                  {copy.composer.resume}
                </Button>
              </span>
            ) : null
          }
        >
          {rule.pausedReason === 'unit-cap'
            ? interpolate(copy.composer.limitBody, {
                given: String(rule.unitsGiven),
                cap: String(rule.effectiveCap ?? rule.unitsGiven),
              })
            : copy.composer.pausedStockBody}
        </Alert>
      ) : null}

      {ended && rule !== null ? (
        <Alert
          tone="info"
          title={interpolate(copy.composer.endedTitle, {
            date: formatDate(rule.effectiveTo ?? rule.updatedAt),
          })}
          data-testid="gift-composer-ended-alert"
          action={
            canWrite ? (
              <span className="gift-composer__resume">
                <Input
                  type="date"
                  aria-label={copy.composer.extendTo}
                  value={extendTo}
                  onChange={(event) => setExtendTo(event.target.value)}
                  data-testid="gift-composer-extend-to"
                />
                <Button
                  disabled={saving || extendTo === '' || problems.length > 0}
                  onClick={() => onSave(values, true, { to: extendTo })}
                  data-testid="gift-composer-extend"
                >
                  {copy.composer.extend}
                </Button>
              </span>
            ) : null
          }
        >
          {copy.composer.endedBody}
        </Alert>
      ) : null}

      {rule !== null && rule.status === 'active' ? (
        <Alert tone="info" data-testid="gift-composer-edit-alert">
          {copy.composer.editNote}
        </Alert>
      ) : null}

      <fieldset className="gift-composer__group" disabled={!canWrite}>
        <legend>{copy.composer.when}</legend>
        {values.kind === 'basket' ? (
          <div className="gift-composer__amount">
            <label htmlFor="gift-basket-min">{copy.composer.basketFrom}</label>
            <Input
              id="gift-basket-min"
              inputMode="decimal"
              value={values.basketMin}
              onChange={(event) => form.setValue('basketMin', event.target.value)}
              data-testid="gift-composer-basket-min"
            />
            <Select
              aria-label={copy.composer.currency}
              value={values.currency}
              onChange={(event) => form.setValue('currency', event.target.value)}
            >
              {['PLN', 'EUR', 'CZK', 'HUF', 'USD', 'GBP'].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
            <p className="text-muted">{copy.composer.basketHelp}</p>
          </div>
        ) : (
          <div data-testid="gift-composer-when-product">
            <p className="text-muted">
              {values.kind === 'unit' ? copy.composer.unitProductHelp : copy.composer.productHelp}
            </p>
            {values.when !== null ? (
              <p>
                <strong>{values.when.name}</strong>{' '}
                <Button tone="secondary" onClick={() => form.setValue('when', null)}>
                  {copy.composer.change}
                </Button>
              </p>
            ) : (
              <BundleProductPicker
                label={copy.composer.productLabel}
                placeholder={copy.composer.productPlaceholder}
                disabled={!canWrite}
                onPick={(choice) => form.setValue('when', toPicked(choice))}
                testIdPrefix="gift-composer-when-search"
              />
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="gift-composer__group" disabled={!canWrite}>
        <legend>{copy.composer.gift}</legend>
        <div data-testid="gift-composer-gift-product">
          {values.gift !== null ? (
            <p>
              <strong>{values.gift.name}</strong>{' '}
              <Button tone="secondary" onClick={() => form.setValue('gift', null)}>
                {copy.composer.change}
              </Button>
            </p>
          ) : (
            <BundleProductPicker
              label={copy.composer.giftLabel}
              placeholder={copy.composer.productPlaceholder}
              disabled={!canWrite}
              onPick={(choice) => form.setValue('gift', toPicked(choice))}
              testIdPrefix="gift-composer-gift-search"
            />
          )}
        </div>
        <label htmlFor="gift-quantity">{copy.composer.quantity}</label>
        <Input
          id="gift-quantity"
          type="number"
          min={1}
          value={values.giftQuantity}
          onChange={(event) => form.setValue('giftQuantity', event.target.value)}
          data-testid="gift-composer-gift-qty"
        />
        {values.gift !== null ? (
          <p data-testid="gift-composer-who-pays">
            {interpolate(copy.order.customerPays, { price: formatAmount(0, values.currency) })}
            {' · '}
            {unitCost === null
              ? copy.composer.costUnknown
              : interpolate(copy.composer.costPerUnit, {
                  cost: formatAmount(Number(unitCost), values.currency),
                })}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="gift-composer__group" disabled={!canWrite} data-testid="gift-composer-channels">
        <legend>{copy.composer.channels}</legend>
        <p className="text-muted">{copy.composer.channelsHelp}</p>
        {channels.map((channel) => {
          const marker = channelMarker(channel.platformType);
          const checked = values.channelIds.length === 0 || values.channelIds.includes(channel.id);
          return (
            <label key={channel.id} className="filter-check" data-testid={`gift-composer-channel-${channel.id}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (values.channelIds.length === 0) {
                    form.setValue(
                      'channelIds',
                      channels.map((c) => c.id).filter((id) => id !== channel.id),
                    );
                  } else {
                    toggleChannel(channel.id);
                  }
                }}
              />
              <span className="filter-check__label">{channel.name}</span>
              <StatusBadge
                tone={marker === 'native' ? 'info' : 'neutral'}
                compact
                data-testid={`gift-composer-channel-marker-${channel.id}`}
              >
                {marker === 'native' ? copy.composer.markerNative : copy.composer.markerOpenLinker}
              </StatusBadge>
            </label>
          );
        })}
        {coversNativeChannel(values.channelIds, channels) ? (
          <Alert tone="warning" density="compact" data-testid="gift-composer-prestashop-warning">
            {copy.composer.doubleGiftWarning}
          </Alert>
        ) : null}
      </fieldset>

      <fieldset className="gift-composer__group" disabled={!canWrite}>
        <legend>{copy.composer.period}</legend>
        <label htmlFor="gift-from">{copy.composer.from}</label>
        <Input
          id="gift-from"
          type="date"
          value={values.from}
          onChange={(event) => form.setValue('from', event.target.value)}
          data-testid="gift-composer-period-from"
        />
        <label htmlFor="gift-to">{copy.composer.to}</label>
        <Input
          id="gift-to"
          type="date"
          value={values.to}
          onChange={(event) => form.setValue('to', event.target.value)}
          data-testid="gift-composer-period-to"
        />
        <p className="text-muted">{copy.composer.periodHelp}</p>
      </fieldset>

      <fieldset className="gift-composer__group" disabled={!canWrite}>
        <legend>{copy.composer.name}</legend>
        <Input
          aria-label={copy.composer.name}
          value={values.name}
          onChange={(event) => {
            setNameTouched(true);
            form.setValue('name', event.target.value);
          }}
          data-testid="gift-composer-name"
        />
        <p className="text-muted">{copy.composer.nameHelp}</p>
      </fieldset>

      <section className="gift-composer__more" data-testid="gift-composer-more">
        <Button tone="secondary" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          {copy.composer.more}
        </Button>
        <p className="text-muted" data-testid="gift-composer-more-summary">
          {moreSummary}
        </p>
        {moreOpen ? (
          <fieldset className="gift-composer__group" disabled={!canWrite}>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={values.doNotCombine}
                onChange={(event) => form.setValue('doNotCombine', event.target.checked)}
                data-testid="gift-composer-opt-no-stack"
              />
              <span className="filter-check__label">{copy.composer.noStack}</span>
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={values.skipIfPresent}
                onChange={(event) => form.setValue('skipIfPresent', event.target.checked)}
                data-testid="gift-composer-opt-skip-present"
              />
              <span className="filter-check__label">{copy.composer.skipPresent}</span>
            </label>
            <label htmlFor="gift-unit-cap">{copy.composer.unitCap}</label>
            <Input
              id="gift-unit-cap"
              type="number"
              min={1}
              value={values.unitCap}
              onChange={(event) => form.setValue('unitCap', event.target.value)}
              data-testid="gift-composer-opt-unit-cap"
            />
            <label htmlFor="gift-per-customer">{copy.composer.perCustomer}</label>
            <Input
              id="gift-per-customer"
              type="number"
              min={1}
              value={values.customerLimit}
              onChange={(event) => form.setValue('customerLimit', event.target.value)}
              data-testid="gift-composer-opt-per-customer"
            />
            {values.kind === 'unit' ? (
              <>
                <label htmlFor="gift-per-n">{copy.composer.perN}</label>
                <Input
                  id="gift-per-n"
                  type="number"
                  min={1}
                  value={values.perN}
                  onChange={(event) => form.setValue('perN', event.target.value)}
                  data-testid="gift-composer-opt-per-n"
                />
                <label htmlFor="gift-max-per-order">{copy.composer.maxPerOrder}</label>
                <Input
                  id="gift-max-per-order"
                  type="number"
                  min={1}
                  value={values.maxPerOrder}
                  onChange={(event) => form.setValue('maxPerOrder', event.target.value)}
                  data-testid="gift-composer-opt-max-per-order"
                />
              </>
            ) : null}
            <label htmlFor="gift-doc-form">{copy.composer.docForm}</label>
            <GiftDocumentFormField
              id="gift-doc-form"
              data-testid="gift-composer-opt-doc-form"
              value={values.documentForm}
              onChange={(next) => form.setValue('documentForm', next)}
            />
          </fieldset>
        ) : null}
      </section>

      <GiftRuleTestPanel ruleId={rule?.id ?? null} draft={draft} />

      {problems.length > 0 && values.name.trim() !== '' ? (
        <p className="text-muted" data-testid="gift-composer-missing">
          {copy.composer.missing}: {problems.map(problemText).join(', ')}
        </p>
      ) : null}
      {saveError !== null ? (
        <Alert tone="error" data-testid="gift-composer-save-error">
          {saveError}
        </Alert>
      ) : null}

      <div className="gift-composer__actions">
        <ReadOnlyLock active={!canWrite} message={copy.list.readOnly}>
          {state === 'new' || state === 'inactive' ? (
            <>
              <Button
                disabled={disabled || problems.length > 0}
                onClick={() => onSave(values, true)}
                data-testid="gift-composer-primary"
              >
                {copy.composer.turnOn}
              </Button>
              <Button
                tone="secondary"
                disabled={disabled || problems.length > 0}
                onClick={() => onSave(values, false)}
                data-testid="gift-composer-save-draft"
              >
                {copy.composer.saveDraft}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={disabled || problems.length > 0 || ended === true}
                onClick={() => onSave(values, true)}
                data-testid="gift-composer-primary"
              >
                {copy.composer.saveChanges}
              </Button>
              {rule !== null && rule.status !== 'ended' ? (
                <Button
                  tone="secondary"
                  disabled={disabled}
                  onClick={() => onSave(values, false)}
                  data-testid="gift-composer-pause"
                >
                  {copy.composer.pause}
                </Button>
              ) : null}
            </>
          )}
          {rule !== null ? (
            <Button tone="secondary" onClick={onCopy} data-testid="gift-composer-copy">
              {copy.composer.copy}
            </Button>
          ) : null}
        </ReadOnlyLock>
      </div>
    </div>
  );
}
