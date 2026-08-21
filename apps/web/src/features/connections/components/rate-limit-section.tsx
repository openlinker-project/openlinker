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
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useRateLimitStatusQuery } from '../hooks/use-rate-limit-status-query';
import type { EditConnectionFormValues } from './edit-connection.schema';
import type { ConnectionRateLimit, ResolveConcurrencyCeiling } from '../api/connections.types';

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
function describeResolveCeiling(ceiling: ResolveConcurrencyCeiling): string {
  const provenance =
    ceiling.source === 'connection-config'
      ? `from your max-concurrent setting, below this adapter's default of ${ceiling.adapterDefault}`
      : 'adapter default';
  return `${ceiling.maxInFlight} requests in flight (${provenance})`;
}

function formatRateLimit(limit: ConnectionRateLimit): string {
  const parts: string[] = [];
  if (limit.requestsPerMinute !== undefined) {
    parts.push(`${limit.requestsPerMinute} requests/min`);
  }
  if (limit.maxConcurrent !== undefined) {
    parts.push(`${limit.maxConcurrent} concurrent`);
  }
  return parts.join(', ');
}

export function RateLimitSection({
  connectionId,
  form,
  configIsParseable,
  syncRateLimitToJson,
  defaultRateLimit,
}: RateLimitSectionProps): ReactElement {
  const errors = form.formState.errors.rateLimit;
  // Absent while loading, on error, and when no adapter declares one. All
  // three render nothing rather than a placeholder: an unstated ceiling is
  // the pre-#2229 status quo, whereas a wrong or provisional number is a new
  // false claim.
  const resolveCeiling = useRateLimitStatusQuery(connectionId).data?.resolveConcurrency;

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
      <h3 className="rate-limit-section__title">Outbound rate limit</h3>
      <p className="rate-limit-section__help">
        OpenLinker spaces requests evenly rather than sending them in bursts.{' '}
        {defaultRateLimit ? (
          <>
            Leave rate limiting off to use this connection&apos;s adapter default —{' '}
            <strong>{formatRateLimit(defaultRateLimit)}</strong>.
          </>
        ) : (
          <>
            Leave rate limiting off and this adapter applies no per-minute or concurrency cap of
            its own here.
          </>
        )}
      </p>

      {resolveCeiling ? (
        <p className="rate-limit-section__help">
          Category matching on this connection runs at most{' '}
          <strong>{describeResolveCeiling(resolveCeiling)}</strong>, at every batch size. That
          ceiling is applied by the adapter itself, separately from the cap below.
        </p>
      ) : null}

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!configIsParseable}
          onChange={(event) => handleEnabledChange(event.target.checked)}
        />
        <span>Enable rate limiting</span>
      </label>

      {enabled ? (
        <>
          <p className="rate-limit-section__help">
            Setting either field below replaces the adapter default entirely — the other field is
            then genuinely unlimited, not still capped by the default. Enforcement is rolling out
            sync path by sync path — setting a cap here has no effect until this connection&apos;s
            outbound traffic has been migrated onto it. If you run multiple API/worker replicas
            (<code>OL_WORKER_REPLICAS</code>), each value is divided evenly across them, so the
            real aggregate throughput matches what you configure below rather than multiplying it
            per replica.
          </p>

          <FormField
            label="Requests per minute"
            name="rateLimit.requestsPerMinute"
            error={errors?.requestsPerMinute?.message}
            description="Smooth-paced cap, split evenly across replicas — e.g. 60 with 1 replica spaces requests roughly one per second."
          >
            <Input
              value={form.watch('rateLimit.requestsPerMinute') ?? ''}
              onChange={(event) => handleChange('requestsPerMinute', event.target.value)}
              disabled={!configIsParseable}
              placeholder={
                defaultRateLimit?.requestsPerMinute !== undefined
                  ? `Default: ${defaultRateLimit.requestsPerMinute}`
                  : 'Unlimited'
              }
              inputMode="numeric"
              invalid={Boolean(errors?.requestsPerMinute)}
            />
          </FormField>

          <FormField
            label="Max concurrent requests"
            name="rateLimit.maxConcurrent"
            error={errors?.maxConcurrent?.message}
            description="Caps simultaneous in-flight requests to this connection, split evenly across replicas. These two caps are independent — whichever one binds first wins."
          >
            <Input
              value={form.watch('rateLimit.maxConcurrent') ?? ''}
              onChange={(event) => handleChange('maxConcurrent', event.target.value)}
              disabled={!configIsParseable}
              placeholder={
                defaultRateLimit?.maxConcurrent !== undefined
                  ? `Default: ${defaultRateLimit.maxConcurrent}`
                  : 'Unlimited'
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
