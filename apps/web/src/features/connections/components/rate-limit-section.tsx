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
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { EditConnectionFormValues } from './edit-connection.schema';
import type { ConnectionRateLimit } from '../api/connections.types';

export interface RateLimitSectionProps {
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
  form,
  configIsParseable,
  syncRateLimitToJson,
  defaultRateLimit,
}: RateLimitSectionProps): ReactElement {
  const errors = form.formState.errors.rateLimit;

  const handleChange = (field: 'requestsPerMinute' | 'maxConcurrent', value: string): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize — the
    // sync function reads CURRENT form state via getValues.
    form.setValue(`rateLimit.${field}`, value, { shouldDirty: true });
    syncRateLimitToJson();
  };

  return (
    <section className="rate-limit-section">
      <h3 className="rate-limit-section__title">Outbound rate limit</h3>
      <p className="rate-limit-section__help">
        OpenLinker spaces requests evenly rather than sending them in bursts.{' '}
        {defaultRateLimit ? (
          <>
            Leave both fields empty to use this connection&apos;s adapter default —{' '}
            <strong>{formatRateLimit(defaultRateLimit)}</strong>. Setting either field replaces the
            adapter default entirely — the other field is then genuinely unlimited, not still
            capped by the default.
          </>
        ) : (
          <>Leave both fields empty for unlimited (the default for this adapter).</>
        )}{' '}
        Enforcement is rolling out sync path by sync path — setting a cap here has no effect until
        this connection&apos;s outbound traffic has been migrated onto it. If you run multiple
        API/worker replicas (<code>OL_WORKER_REPLICAS</code>), each value is divided evenly across
        them, so the real aggregate throughput matches what you configure below rather than
        multiplying it per replica.
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
    </section>
  );
}
