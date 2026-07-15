/**
 * KSeF Adapter Factory
 *
 * Single per-connection construction seam for the KSeF plugin. Resolves the
 * connection's credentials via the host `CredentialsResolverPort`, validates
 * the config + credential shape, and builds the concrete `KsefHttpClient` (auth
 * header injection, retry/backoff, token lifecycle) wired to the FA(3)
 * issuance + clearance mechanics on the same client. Routing all construction
 * through here keeps credential + environment resolution in one place (the
 * Allegro/Erli precedent).
 *
 * Not `@Injectable` — a plain class; the client it builds closes over one
 * connection's resolved secret, never a DI singleton.
 *
 * SECURITY: the resolved token is handed straight into the client's token
 * material and never logged. A missing `credentialsRef`, unresolvable secret, or
 * malformed credential shape fails fast with `KsefConfigException` before any
 * request leaves the client (ADR-003).
 *
 * Qualified-seal (X.509) connections need real X.509/HSM signing material this
 * package does not yet implement — they throw `KsefConfigException` here so
 * the connection fails loudly rather than half-wiring an unusable client. See
 * `KsefAuthXmlBuilder.signXades` for the deferred signing implementation.
 *
 * @module libs/integrations/ksef/src/application/factories
 */
import type { CachePort } from '@openlinker/shared/cache';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { KsefInvoicingAdapter } from '../../infrastructure/adapters/ksef-invoicing.adapter';
import { createKsefHttpClient } from '../../infrastructure/http/ksef-http-client.factory';
import { getSharedKsefRateLimiter } from '../../infrastructure/http/ksef-rate-limiter';
import { KsefSessionCryptoService } from '../../infrastructure/crypto/ksef-session-crypto.service';
import { Fa3WithValidationBuilder } from '../../infrastructure/fa3/builders/fa3-with-validation.builder';
import { NbpExchangeRateClient } from '../../infrastructure/fx/nbp-exchange-rate.client';
import { DEFAULT_FA3_TAX_RATE } from '../../infrastructure/fa3/domain/fa3-tax-rate.mapper';
import type { Fa3PaymentInput, SellerProfile } from '../../infrastructure/fa3/domain/fa3-xml.types';
import type { KsefTokenAuthMaterial } from '../../infrastructure/http/auth/ksef-auth-handshake.service';
import type {
  KsefConnectionConfig,
  KsefCredentials,
  KsefEnvironment,
  KsefPaymentConfig,
  KsefSellerConfig,
} from '../../domain/types/ksef-connection.types';
import { KsefEnvironmentValues, KsefFormaPlatnosciValues } from '../../domain/types/ksef-connection.types';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';
import type { IKsefAdapterFactory, KsefAdapters } from '../interfaces/ksef-adapter.factory.interface';

export type { KsefAdapters };

export class KsefAdapterFactory implements IKsefAdapterFactory {
  constructor(private readonly cache?: CachePort) {}

  async createAdapters(
    connection: Connection,
    _identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefAdapters> {
    const env = this.resolveEnvironment(connection);
    const credentials = await this.resolveCredentials(connection, credentialsResolver);
    const authMaterial = this.resolveAuthMaterial(connection, credentials);

    const seller = this.resolveSeller(connection);
    const defaultTaxRate = this.resolveDefaultTaxRate(connection);
    const payment = this.resolvePayment(connection);
    const defaultLineUnit = this.resolveDefaultLineUnit(connection);
    const allowCrossBorder = this.resolveAllowCrossBorder(connection);

    const { httpClient, publicKeyCache } = createKsefHttpClient({
      connectionId: connection.id,
      env,
      authMaterial,
      cache: this.cache,
      // #1594: proactive per-hour pacing keyed on the seller NIP (KSeF buckets by
      // NIP), shared process-wide so sibling connections on the same NIP throttle
      // against one bucket rather than each other.
      rateLimiter: getSharedKsefRateLimiter(),
      rateLimitBucketKey: seller.nip,
    });

    // C5 issuance dependencies: the session-crypto service (shares the same
    // MF public-key cache as the transport) + the FA(3) build/validate pipeline.
    const sessionCrypto = new KsefSessionCryptoService(publicKeyCache);
    const fa3Builder = new Fa3WithValidationBuilder();
    // NBP exchange-rate resolver (#1581) — used only when a command's currency is
    // not PLN (art. 106e ust. 11 PLN/VAT conversion). Native-fetch client, no new
    // npm dependency; a single shared instance is safe (stateless).
    const exchangeRateResolver = new NbpExchangeRateClient();

    return {
      invoicing: new KsefInvoicingAdapter(
        connection.id,
        httpClient,
        sessionCrypto,
        fa3Builder,
        seller,
        defaultTaxRate,
        { payment, defaultLineUnit, exchangeRateResolver, allowCrossBorder },
      ),
    };
  }

  private resolveEnvironment(connection: Connection): KsefEnvironment {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const env = config?.env;
    if (!env || !KsefEnvironmentValues.includes(env)) {
      throw new KsefConfigException(`KSeF connection has no valid environment`, connection.id);
    }
    return env;
  }

  /**
   * Resolve the seller profile (Podmiot1) from the connection config. This is
   * system configuration — never a per-invoice input, never a credential — so it
   * lives on the connection row. A connection that lacks a well-formed seller
   * fails fast here rather than producing an FA(3) the XSD would reject.
   */
  private resolveSeller(connection: Connection): SellerProfile {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const seller: KsefSellerConfig | undefined = config?.seller;
    const address = seller?.address;
    if (
      !seller ||
      typeof seller.nip !== 'string' ||
      seller.nip.trim().length === 0 ||
      typeof seller.name !== 'string' ||
      seller.name.trim().length === 0 ||
      !address ||
      typeof address.line1 !== 'string' ||
      typeof address.city !== 'string' ||
      typeof address.postalCode !== 'string' ||
      typeof address.countryIso2 !== 'string'
    ) {
      throw new KsefConfigException(
        'KSeF connection has no valid seller profile (nip/name/address required for issuance)',
        connection.id,
      );
    }
    // Trimmed like resolveContextNip — both consumers (the <ContextNip>
    // handshake and the FA(3) Podmiot1 block) must see one canonical value.
    return {
      nip: seller.nip.trim(),
      name: seller.name.trim(),
      address: {
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        postalCode: address.postalCode,
        countryIso2: address.countryIso2,
      },
    };
  }

  /**
   * Resolve the connection-level fallback `P_12` neutral code (adapter-scoped
   * issuance policy, not seller identity — see `Fa3MappingContext.defaultTaxRate`).
   * The `.trim() ||` fallback is defensive for configs saved before the
   * `ksef.publicapi.v2` shape validator started rejecting a whitespace-only
   * `seller.defaultTaxRate` (#1291) — a post-validation config can never
   * actually hit the empty branch, but a pre-existing row could.
   */
  private resolveDefaultTaxRate(connection: Connection): string {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    return config?.seller?.defaultTaxRate?.trim() || DEFAULT_FA3_TAX_RATE;
  }

  /**
   * Resolve the connection-level default unit of measure (`P_8A`, #1525) from
   * `config.invoiceDefaults.lineUnit`. Mirrors `resolveDefaultTaxRate`'s
   * defensive trim; unlike the tax rate there is NO hard default - an
   * absent/empty value returns `undefined` and unit-less lines omit `P_8A`
   * entirely (clearing the field stops emission).
   */
  private resolveDefaultLineUnit(connection: Connection): string | undefined {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const lineUnit = config?.invoiceDefaults?.lineUnit;
    return typeof lineUnit === 'string' && lineUnit.trim().length > 0
      ? lineUnit.trim()
      : undefined;
  }

  /**
   * Resolve the interim cross-border escape hatch (#1586) from
   * `config.allowCrossBorder`. Defaults to `false` (refuse cross-border sales)
   * for any connection that has not explicitly opted in - only a literal `true`
   * enables issuance of a sale to a country other than the seller's own.
   */
  private resolveAllowCrossBorder(connection: Connection): boolean {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    return config?.allowCrossBorder === true;
  }

  /**
   * Resolve the connection-level default payment info (#1311) into the
   * builder's neutral `Fa3PaymentInput` shape. Unlike `resolveSeller`, an
   * absent/empty `config.payment` is a valid, common state — this returns
   * `undefined` rather than throwing, so the builder omits `Platnosc`
   * entirely. Defensive against a malformed `bankAccount` (empty `nrRb`), an
   * unknown `formaPlatnosci` code, or a negative/non-integer
   * `paymentTermDays` slipping through pre-validator connections, mirroring
   * `resolveDefaultTaxRate`'s defensive posture — each field is dropped
   * rather than emitted verbatim if it fails the same check the
   * `ksef.publicapi.v2` shape validator applies at save time.
   *
   * The required-together invariants are thus enforced in three layers (FE
   * assembly, the shape validator, and here) — intentional defense-in-depth
   * matching the `resolveSeller` precedent (PR #1317 review): each layer
   * guards a different entry path (operator UI, API writes, pre-validator /
   * out-of-band config rows), so none of the three can be dropped without
   * reopening one of those paths.
   */
  private resolvePayment(connection: Connection): Fa3PaymentInput | undefined {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const payment: KsefPaymentConfig | undefined = config?.payment;
    if (!payment) {
      return undefined;
    }
    const result: Fa3PaymentInput = {};
    if (
      payment.formaPlatnosci !== undefined &&
      (KsefFormaPlatnosciValues as readonly string[]).includes(payment.formaPlatnosci)
    ) {
      result.formaPlatnosci = payment.formaPlatnosci;
    }
    // Whitespace-stripped defensively: the FE strips at assembly time and the
    // shape validator rejects spaced values at save time, but a pre-validator
    // config row could still carry a conventionally-spaced NRB — emitted
    // verbatim it would fail KSeF's TNrRB pattern at clearance (PR #1317
    // review). A whitespace-only value strips to '' and drops the block.
    const nrRb = payment.bankAccount?.nrRb?.replace(/\s+/g, '');
    if (nrRb) {
      result.bankAccount = {
        nrRb,
        ...(payment.bankAccount?.bankName ? { bankName: payment.bankAccount.bankName } : {}),
        ...(payment.bankAccount?.swift ? { swift: payment.bankAccount.swift } : {}),
      };
    }
    if (
      payment.paymentTermDays !== undefined &&
      Number.isInteger(payment.paymentTermDays) &&
      payment.paymentTermDays >= 0
    ) {
      result.paymentTermDays = payment.paymentTermDays;
    }
    if (payment.skonto?.conditions && payment.skonto.amount) {
      result.skonto = payment.skonto;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefCredentials> {
    if (!connection.credentialsRef) {
      throw new KsefConfigException('KSeF connection has no credentialsRef', connection.id);
    }
    const credentials = await credentialsResolver.get<KsefCredentials>(connection.credentialsRef);
    if (!credentials?.authType || !credentials?.secret) {
      throw new KsefConfigException('KSeF credentials missing authType or secret', connection.id);
    }
    return credentials;
  }

  /**
   * Builds the token auth material from the single resolved credentials
   * payload. `contextNip` is the KSeF session-context identifier the XML
   * handshake requires — sourced from the connection's seller profile
   * (`config.seller.nip`, already collected by the setup wizard) rather than a
   * second credentials lookup: KSeF's context NIP is normally the seller's own
   * NIP, and there is no separate secret carrying it.
   */
  private resolveAuthMaterial(connection: Connection, credentials: KsefCredentials): KsefTokenAuthMaterial {
    if (credentials.authType !== 'ksef-token') {
      // Qualified-seal needs real X.509/HSM signing material — not yet implemented.
      throw new KsefConfigException(
        `KSeF authType '${credentials.authType}' is not yet supported (qualified-seal signing is not implemented)`,
        connection.id,
      );
    }
    const contextNip = this.resolveContextNip(connection);
    return { authType: 'ksef-token', token: credentials.secret, contextNip };
  }

  private resolveContextNip(connection: Connection): string {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const nip = config?.seller?.nip?.trim();
    if (!nip) {
      throw new KsefConfigException(
        'KSeF connection has no seller NIP configured (required as the session context identifier)',
        connection.id,
      );
    }
    // Trimmed — the value lands verbatim in the <ContextNip> XML element, so a
    // hand-edited config row with stray whitespace must not leak into the handshake.
    return nip;
  }
}
