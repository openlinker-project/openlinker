/**
 * RateLimitSection (#1810)
 *
 * Generic, platform-neutral per-connection outbound rate-limit editor —
 * `config.rateLimit`. Unlike every other structured section in this
 * feature, it is rendered for EVERY connection regardless of `platformType`
 * (mirrors the `stockSafetyBuffer`/`pricingRule` core precedent, but this is
 * the first of that family to actually get an FE control).
 *
 * Both knobs are independently optional; leaving both empty falls back to
 * the resolved adapter's `defaultRateLimit` (#1810) rather than always
 * meaning unlimited — PrestaShop/WooCommerce ship a non-null default, so
 * this component reads `connection.defaultRateLimit` and renders the real
 * effective policy instead of a blanket "unlimited" claim. Client-side
 * bounds mirror the server-side check in
 * `ConnectionService.validateRateLimitConfig` (1-6000 / 1-64) via the Zod
 * schema — this component only renders errors, it does not duplicate the
 * bounds check itself.
 *
 * Since #2229 it also states the connection's category-resolve in-flight
 * ceiling, which is applied inside the adapter's own resolver BELOW the
 * limiter these fields configure. That line lives here rather than in
 * `PrestashopRateLimitReadout` for one reason: this section renders for every
 * connection, and the readout is mounted only by the PrestaShop plugin — so
 * Allegro, the one platform that has a ceiling today, would never have shown
 * it. The two are also different in kind: a live in-flight/queued readout
 * versus a static declared ceiling.
 *
 * When the status read reports a shared bucket (ADR-038 § Amendment), it says
 * so in one line: the live counters then include other connections' traffic
 * and the fields below can only tighten the shop's ceiling, both of which
 * would otherwise read as a bug.
 *
 * @module features/connections/components
 */
import {
  interpolate,
  renderRich,
  useMessages,
  type Messages,
  type ResolvedCopy,
} from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '../../../shared/ui/form-field';
import { HelpLink } from '../../../shared/ui/help-link';
import { Input } from '../../../shared/ui/input';
import { useRateLimitStatusQuery } from '../hooks/use-rate-limit-status-query';
import type { EditConnectionFormValues } from './edit-connection.schema';
import type { ConnectionRateLimit, ResolveConcurrencyCeiling } from '../api/connections.types';

type RateLimitCopy = ResolvedCopy<Messages['connections']>['rateLimitSection'];

export interface RateLimitSectionProps {
  /** Reads the adapter-declared resolve ceiling (#2229). */
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable — inputs are disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue (ordering trap — see CapabilityTogglesSection). */
  syncRateLimitToJson: () => void;
  /**
   * The resolved adapter's fallback rate limit (#1810) — `connection.defaultRateLimit`.
   * `null` means the adapter declares none, so leaving both fields empty is
   * truly unlimited; otherwise it's the cap actually applied while these
   * fields are empty, and the help text below must say so rather than the
   * blanket "unlimited" claim that stopped being true the moment an
   * adapter started shipping a non-null default.
   */
  defaultRateLimit: ConnectionRateLimit | null;
}

/**
 * One sentence, two facts: the number and where it came from. Deliberately not
 * a table of `maxInFlight` / `source` / `adapterDefault` — the operator needs
 * the ceiling and whether they set it, and the third value only earns its
 * place when it explains a clamp.
 */
function describeResolveCeiling(copy: RateLimitCopy, ceiling: ResolveConcurrencyCeiling): string {
  return ceiling.source === 'connection-config'
    ? interpolate(copy.ceiling.fromSetting, {
        n: ceiling.maxInFlight,
        adapterDefault: ceiling.adapterDefault,
      })
    : interpolate(copy.ceiling.adapterDefault, { n: ceiling.maxInFlight });
}

function formatRateLimit(copy: RateLimitCopy, limit: ConnectionRateLimit): string {
  if (limit.requestsPerMinute !== undefined && limit.maxConcurrent !== undefined) {
    return interpolate(copy.defaultLimit.both, {
      perMinute: limit.requestsPerMinute,
      concurrent: limit.maxConcurrent,
    });
  }
  if (limit.requestsPerMinute !== undefined) {
    return interpolate(copy.defaultLimit.perMinute, { perMinute: limit.requestsPerMinute });
  }
  if (limit.maxConcurrent !== undefined) {
    return interpolate(copy.defaultLimit.concurrent, { concurrent: limit.maxConcurrent });
  }
  return '';
}

export function RateLimitSection({
  connectionId,
  form,
  configIsParseable,
  syncRateLimitToJson,
  defaultRateLimit,
}: RateLimitSectionProps): ReactElement {
  const copy = useMessages('connections').rateLimitSection;
  const errors = form.formState.errors.rateLimit;
  // Absent while loading, on error, and when no adapter declares one. All
  // three render nothing rather than a placeholder: an unstated ceiling is
  // the pre-#2229 status quo, whereas a wrong or provisional number is a new
  // false claim.
  const status = useRateLimitStatusQuery(connectionId).data;
  const resolveCeiling = status?.resolveConcurrency;
  // Same rule as the ceiling: only the server's positive answer renders the
  // note, so loading and error states never claim a bucket is shared.
  const sharedBucket = status?.sharedBucket === true;

  const hasStoredValue =
    Boolean(form.getValues('rateLimit.requestsPerMinute')) ||
    Boolean(form.getValues('rateLimit.maxConcurrent'));
  // Local UI state (docs/frontend-architecture.md § Local UI State) — whether
  // the override inputs are shown. NOT derived from the field values on every
  // render: turning the checkbox ON with both fields still empty must keep
  // the inputs visible (a derived `enabled` would immediately flip back to
  // "off" the instant it's checked, since neither field has a value yet).
  // Invariant: nothing outside this component may call
  // `form.setValue('rateLimit.*', …)` — this frozen state won't notice, and a
  // knob could populate behind a checkbox still rendered unchecked.
  const [enabled, setEnabled] = useState(hasStoredValue);

  const handleChange = (field: 'requestsPerMinute' | 'maxConcurrent', value: string): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize — the
    // sync function reads CURRENT form state via getValues.
    form.setValue(`rateLimit.${field}`, value, { shouldDirty: true });
    syncRateLimitToJson();
  };

  // #2016 — unchecking is the "revert to adapter default / unlimited" action.
  // Clearing both fields (rather than just hiding them) is what makes
  // `mergeStructuredIntoConfig`'s rateLimit clause persist an explicit
  // `config.rateLimit: null` instead of leaving a stale value in place.
  // Always sync (checking and unchecking alike) — otherwise checking the box
  // with both knobs left blank never re-serializes into `configText`, and
  // Save fires its success toast over a payload that silently didn't change.
  const handleEnabledChange = (checked: boolean): void => {
    setEnabled(checked);
    if (!checked) {
      form.setValue('rateLimit.requestsPerMinute', '', { shouldDirty: true });
      form.setValue('rateLimit.maxConcurrent', '', { shouldDirty: true });
    }
    syncRateLimitToJson();
  };

  return (
    <section className="rate-limit-section">
      <div className="section-title__with-help">
        <h3 className="rate-limit-section__title">{copy.title}</h3>
        <HelpLink surfaceKey="connection-rate-limit" />
      </div>
      <p className="rate-limit-section__help">
        {copy.intro}{' '}
        {defaultRateLimit
          ? renderRich(copy.withDefault, {
              strong: (text) => <strong>{text}</strong>,
            }, { limit: formatRateLimit(copy, defaultRateLimit) })
          : copy.withoutDefault}
      </p>

      {sharedBucket ? (
        <p className="rate-limit-section__help">
          {copy.shared}
        </p>
      ) : null}

      {resolveCeiling ? (
        <p className="rate-limit-section__help">
          {renderRich(
            copy.ceiling.sentence,
            { strong: (text) => <strong>{text}</strong> },
            { ceiling: describeResolveCeiling(copy, resolveCeiling) },
          )}
        </p>
      ) : null}

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!configIsParseable}
          onChange={(event) => handleEnabledChange(event.target.checked)}
        />
        <span>{copy.enable}</span>
      </label>

      {enabled ? (
        <>
          <p className="rate-limit-section__help">
            {sharedBucket ? copy.fieldsShared : copy.fieldsReplace} {copy.rollout}
          </p>

          <FormField
            label={copy.requestsPerMinute.label}
            name="rateLimit.requestsPerMinute"
            error={errors?.requestsPerMinute?.message}
            description={copy.requestsPerMinute.description}
          >
            <Input
              value={form.watch('rateLimit.requestsPerMinute') ?? ''}
              onChange={(event) => handleChange('requestsPerMinute', event.target.value)}
              disabled={!configIsParseable}
              placeholder={
                defaultRateLimit?.requestsPerMinute !== undefined
                  ? interpolate(copy.defaultPlaceholder, { value: defaultRateLimit.requestsPerMinute })
                  : copy.unlimited
              }
              inputMode="numeric"
              invalid={Boolean(errors?.requestsPerMinute)}
            />
          </FormField>

          <FormField
            label={copy.maxConcurrent.label}
            name="rateLimit.maxConcurrent"
            error={errors?.maxConcurrent?.message}
            description={copy.maxConcurrent.description}
          >
            <Input
              value={form.watch('rateLimit.maxConcurrent') ?? ''}
              onChange={(event) => handleChange('maxConcurrent', event.target.value)}
              disabled={!configIsParseable}
              placeholder={
                defaultRateLimit?.maxConcurrent !== undefined
                  ? interpolate(copy.defaultPlaceholder, { value: defaultRateLimit.maxConcurrent })
                  : copy.unlimited
              }
              inputMode="numeric"
              invalid={Boolean(errors?.maxConcurrent)}
            />
          </FormField>
        </>
      ) : null}
    </section>
  );
}
