/**
 * Retry Classifier Registry Service
 *
 * Holds `RetryClassifierPort` implementations keyed by `adapterKey`.
 * Integration modules register their classifiers at bootstrap alongside
 * their adapter factory + connection tester, mirroring the shape of
 * `ConnectionTesterRegistryService` and `WebhookProvisioningRegistryService`.
 *
 * Consumed by `SyncJobRunner` to answer "is this error non-retryable?"
 * without importing platform-specific exception classes. The runner has
 * the raw error in hand (not an `adapterKey`), so dispatch differs from
 * the sibling registries: `isNonRetryable(cause)` walks every registered
 * classifier and OR's the answers — each classifier owns disjoint
 * exception hierarchies, so at most one matches in practice. Iteration
 * is O(handful) and each classifier's check is O(1) `instanceof`.
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sister registries;
 * integration modules register exactly once at boot so collisions are
 * near-impossible by construction (#581).
 *
 * @module libs/core/src/sync/infrastructure/adapters
 * @see {@link RetryClassifierPort} for the port interface.
 */
import { Injectable } from '@nestjs/common';
import type { RetryClassifierPort, RetryDeferral } from '../../domain/ports/retry-classifier.port';

/**
 * Hard ceiling on a single classifier-reported deferral (#2613 review).
 * One hour is already longer than any destination's own `Retry-After` in the
 * tree; past that the job should come back and be re-classified rather than
 * disappear from view.
 */
const MAX_DEFERRAL_DELAY_SECONDS = 3600;

@Injectable()
export class RetryClassifierRegistryService {
  private readonly classifiers: Map<string, RetryClassifierPort> = new Map();

  register(adapterKey: string, classifier: RetryClassifierPort): void {
    this.classifiers.set(adapterKey, classifier);
  }

  get(adapterKey: string): RetryClassifierPort | undefined {
    return this.classifiers.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.classifiers.has(adapterKey);
  }

  /**
   * Aggregate non-retryable classification across registered classifiers.
   * Returns `true` as soon as any classifier reports the cause as
   * non-retryable; `false` if no classifier matches (the default —
   * unknown errors are retryable).
   */
  isNonRetryable(cause: unknown): boolean {
    for (const classifier of this.classifiers.values()) {
      if (classifier.isNonRetryable(cause)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve a retry deferral across registered classifiers (#2613). First
   * usable answer wins - classifiers own disjoint exception hierarchies, so at
   * most one can recognise the cause. Classifiers that do not implement the
   * optional method are skipped.
   *
   * The delay is coerced here rather than trusted, because the value crosses a
   * plugin boundary: a non-positive or non-finite delay is ignored so a
   * miscomputed zero cannot turn a deferral into a hot requeue loop, and a
   * delay longer than the cap is clamped down so a buggy plugin returning
   * 10^9 cannot park a job for decades.
   */
  resolveRetryDeferral(cause: unknown): RetryDeferral | null {
    for (const classifier of this.classifiers.values()) {
      const deferral = classifier.getRetryDeferral?.(cause) ?? null;
      if (deferral === null) {
        continue;
      }
      if (!Number.isFinite(deferral.delaySeconds) || deferral.delaySeconds <= 0) {
        continue;
      }
      if (deferral.delaySeconds > MAX_DEFERRAL_DELAY_SECONDS) {
        return { reason: deferral.reason, delaySeconds: MAX_DEFERRAL_DELAY_SECONDS };
      }
      return deferral;
    }
    return null;
  }
}
