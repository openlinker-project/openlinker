/**
 * Email Normalizer Registry Service
 *
 * Holds `EmailNormalizerPort` implementations keyed by `adapterKey`.
 * Integration modules register their normalizers at bootstrap alongside
 * their adapter factory + connection tester + webhook provisioner,
 * mirroring `WebhookProvisioningRegistryService` (#583) and
 * `ConnectionTesterRegistryService`. Consumed by
 * `CustomerIdentityResolverService` to translate platform-specific email
 * formats (e.g. Allegro `fixedPart+transactionId@allegromail.*`) into the
 * stable identity form used for emailHash dedup — replacing the previous
 * hardcoded `normalizeEmail(email, 'allegro')` calls that leaked Allegro
 * semantics into platform-agnostic `libs/core` / `libs/shared` (#585 / E5).
 *
 * `resolve(adapterKey)` returns `DEFAULT_EMAIL_NORMALIZER` (trim+lowercase
 * baseline) when no platform-specific normalizer is registered — so the
 * resolver path can call it unconditionally without per-platform branching.
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sister registries;
 * integration modules register exactly once at boot so collisions are
 * near-impossible by construction.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link EmailNormalizerPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { EmailNormalizerPort } from '../../domain/ports/email-normalizer.port';
import { DEFAULT_EMAIL_NORMALIZER } from './default-email-normalizer';

@Injectable()
export class EmailNormalizerRegistryService {
  private readonly normalizers: Map<string, EmailNormalizerPort> = new Map();

  register(adapterKey: string, normalizer: EmailNormalizerPort): void {
    this.normalizers.set(adapterKey, normalizer);
  }

  get(adapterKey: string): EmailNormalizerPort | undefined {
    return this.normalizers.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.normalizers.has(adapterKey);
  }

  /**
   * Resolve the registered normalizer for `adapterKey`, falling back to the
   * trim+lowercase baseline (`DEFAULT_EMAIL_NORMALIZER`) when no
   * platform-specific normalizer is registered. Lets call sites issue a
   * single unconditional `resolve(...).normalize(email)` instead of
   * branching on registry hits.
   */
  resolve(adapterKey: string): EmailNormalizerPort {
    return this.normalizers.get(adapterKey) ?? DEFAULT_EMAIL_NORMALIZER;
  }
}
