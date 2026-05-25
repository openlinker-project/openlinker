/**
 * Auth Failure Classifier Registry Service
 *
 * Holds `AuthFailureClassifierPort` implementations keyed by `adapterKey`.
 * Integration modules register their classifiers at bootstrap alongside their
 * adapter factory + retry classifier, mirroring the shape of
 * `RetryClassifierRegistryService`.
 *
 * Consumed by `SyncJobRunner` to answer "does this terminal error mean the
 * connection's credentials were rejected (re-auth required)?" without importing
 * platform-specific exception classes. The runner has the raw error in hand
 * (not an `adapterKey`), so dispatch differs from key-indexed registries:
 * `isCredentialRejected(cause)` walks every registered classifier and OR's the
 * answers — each classifier owns disjoint exception hierarchies, so at most one
 * matches in practice. Iteration is O(handful) and each check is O(1)
 * `instanceof`.
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sister registries;
 * integration modules register exactly once at boot so collisions are
 * near-impossible by construction (#819).
 *
 * @module libs/core/src/sync/infrastructure/adapters
 * @see {@link AuthFailureClassifierPort} for the port interface.
 */
import { Injectable } from '@nestjs/common';
import type { AuthFailureClassifierPort } from '../../domain/ports/auth-failure-classifier.port';

@Injectable()
export class AuthFailureClassifierRegistryService {
  private readonly classifiers: Map<string, AuthFailureClassifierPort> = new Map();

  register(adapterKey: string, classifier: AuthFailureClassifierPort): void {
    this.classifiers.set(adapterKey, classifier);
  }

  get(adapterKey: string): AuthFailureClassifierPort | undefined {
    return this.classifiers.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.classifiers.has(adapterKey);
  }

  /**
   * Aggregate credential-rejection classification across registered
   * classifiers. Returns `true` as soon as any classifier reports the cause as
   * a terminal credential rejection; `false` if no classifier matches (the
   * default — unknown errors are not treated as credential rejections).
   */
  isCredentialRejected(cause: unknown): boolean {
    for (const classifier of this.classifiers.values()) {
      if (classifier.isCredentialRejected(cause)) {
        return true;
      }
    }
    return false;
  }
}
