/**
 * In-Memory Credentials-Resolver Adapter
 *
 * Test-time-only adapter implementing `CredentialsResolverPort`. Backed by an
 * internal `Map<string, unknown>`; specs seed credentials inline rather than
 * setting environment variables or mocking a vault.
 *
 * **Placement**: lives at `<context>/testing/` rather than
 * `<context>/infrastructure/adapters/` because it is never wired into a
 * production module graph — only consumed by `*.spec.ts` files in plugin
 * packages. See the identifier-mapping fake header for the placement
 * rationale.
 *
 * @module libs/core/src/integrations/testing
 * @see {@link CredentialsResolverPort} for the port contract
 */
import type { CredentialsResolverPort } from '../domain/ports/credentials-resolver.port';

export class InMemoryCredentialsResolverAdapter implements CredentialsResolverPort {
  private readonly store = new Map<string, unknown>();

  /**
   * @param initial optional map of `credentialsRef` → credentials object. Seeded
   *   on construction. Specs can also call {@link seed} later.
   */
  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [ref, credentials] of Object.entries(initial)) {
      this.store.set(ref, credentials);
    }
  }

  get<T = unknown>(credentialsRef: string): Promise<T> {
    if (!this.store.has(credentialsRef)) {
      return Promise.reject(new Error(`Credentials not found for ref: ${credentialsRef}`));
    }
    return Promise.resolve(this.store.get(credentialsRef) as T);
  }

  // ----- test helpers (not part of the port contract) -----

  clear(): void {
    this.store.clear();
  }

  seed(ref: string, credentials: unknown): void {
    this.store.set(ref, credentials);
  }
}
