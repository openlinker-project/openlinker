/**
 * Mirakl Adapter Factory
 *
 * Builds one connection's HTTP client and import tracker from the operator
 * profile and the connection's credentials and config. Every Mirakl adapter
 * and the connection tester go through here, so key, base URL and shop id are
 * resolved in one place.
 *
 * The config validator already refuses a bad shop id on save; this re-checks,
 * because a row written around the validator must fail before a request, not
 * act on the key's default shop.
 *
 * Plain class, not `@Injectable`: what it builds closes over one connection's
 * key.
 *
 * @module libs/integrations/mirakl/src/application
 * @implements {IMiraklAdapterFactory}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { FetchLike } from '@openlinker/shared/http';
import { MiraklConfigException } from '../domain/exceptions/mirakl-config.exception';
import {
  isMiraklEnvironment,
  readMiraklCarrierCodes,
  readMiraklOfferDefaults,
  readMiraklShopId,
  resolveMiraklBaseUrl,
  resolveMiraklOrderAcceptance,
} from '../domain/policies/mirakl-connection-config.policy';
import type {
  MiraklConnectionConfig,
  MiraklCredentials,
} from '../domain/types/mirakl-connection.types';
import type { MiraklOperatorProfile } from '../domain/types/mirakl-operator-profile.types';
import { MiraklHttpClient } from '../infrastructure/http/mirakl-http-client';
import type { IMiraklHttpClient } from '../infrastructure/http/mirakl-http-client.interface';
import type { RetryConfig } from '../infrastructure/http/mirakl-http-client.types';
import { MiraklInventoryMasterAdapter } from '../infrastructure/adapters/catalog-master/mirakl-inventory-master.adapter';
import { MiraklMasterIdentity } from '../infrastructure/adapters/catalog-master/mirakl-master-identity';
import { MiraklOfferReader } from '../infrastructure/adapters/catalog-master/mirakl-offer-reader';
import { MiraklProductMediaReader } from '../infrastructure/adapters/catalog-master/mirakl-product-media-reader';
import { MiraklProductMasterAdapter } from '../infrastructure/adapters/catalog-master/mirakl-product-master.adapter';
import { MiraklOfferManagerAdapter } from '../infrastructure/adapters/mirakl-offer-manager.adapter';
import {
  MiraklOrderSourceAdapter,
  MiraklRefundingOrderSourceAdapter,
} from '../infrastructure/adapters/mirakl-order-source.adapter';
import { MiraklRefundExecutor } from '../infrastructure/adapters/mirakl-refunds';
import type { MiraklOfferWriteRepositoryPort } from '../domain/ports/mirakl-offer-write-repository.port';
import { MiraklImportTracker } from '../infrastructure/imports/mirakl-import-tracker';
import type {
  IMiraklAdapterFactory,
  MiraklAdapters,
  MiraklConnectionClients,
  MiraklMasterServices,
} from './interfaces/mirakl-adapter.factory.interface';

/** What the host provides beyond the connection: the offer write store. */
export interface MiraklAdapterFactoryDeps {
  /**
   * Read at adapter build time, so the store the integration module creates
   * during DI is seen even though the plugin was described before it.
   */
  readonly offerWrites?: () => MiraklOfferWriteRepositoryPort | undefined;
  /** Serialises stock writes per offer when Mirakl is the stock master (#4284). */
  readonly lock?: () => SyncLockPort | undefined;
}

export class MiraklAdapterFactory implements IMiraklAdapterFactory {
  constructor(
    private readonly profile: MiraklOperatorProfile,
    private readonly deps: MiraklAdapterFactoryDeps = {}
  ) {}

  async createClients(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    retryConfig?: Partial<RetryConfig>
  ): Promise<MiraklConnectionClients> {
    const credentials = await this.resolveCredentials(connection, credentialsResolver);
    const config = (connection.config ?? {}) as MiraklConnectionConfig;
    const shopId = this.resolveShopId(connection, config);
    const httpClient = new MiraklHttpClient(
      connection.id,
      resolveMiraklBaseUrl(this.profile, config.environment),
      credentials.apiKey.trim(),
      fetchImpl,
      shopId,
      retryConfig
    );
    return { httpClient, importTracker: new MiraklImportTracker(httpClient, connection.id) };
  }

  async createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    master: MiraklMasterServices
  ): Promise<MiraklAdapters> {
    const { httpClient, importTracker } = await this.createClients(
      connection,
      credentialsResolver,
      fetchImpl
    );
    const config = (connection.config ?? {}) as MiraklConnectionConfig;
    const offerDefaults = readMiraklOfferDefaults(config.offerDefaults);
    // One reader for both masters, so a product read and its stock read in the
    // same job cost one OF21 call.
    const offerReader = new MiraklOfferReader(httpClient);
    const identity = new MiraklMasterIdentity(connection.id, master.identifierMapping);
    return {
      orderSource: this.createOrderSource(connection, httpClient, config, master),
      offerManager: new MiraklOfferManagerAdapter({
        connectionId: connection.id,
        adapterKey: this.profile.adapterKey,
        brand: this.profile.brand,
        httpClient,
        importTracker,
        writes: this.deps.offerWrites?.(),
        taxonomyOwner:
          this.profile.taxonomyOwners[
            isMiraklEnvironment(config.environment) ? config.environment : 'production'
          ],
        offerDefaults: offerDefaults.kind === 'valid' ? offerDefaults : {},
        cardAttributes: this.profile.cardAttributes,
        identifierMapping: master.identifierMapping,
      }),
      productMaster: new MiraklProductMasterAdapter(
        connection.id,
        this.profile.brand,
        offerReader,
        identity,
        new MiraklProductMediaReader(httpClient)
      ),
      inventoryMaster: new MiraklInventoryMasterAdapter({
        connectionId: connection.id,
        brand: this.profile.brand,
        httpClient,
        importTracker,
        writes: this.deps.offerWrites?.(),
        reader: offerReader,
        identity,
        cache: master.cache,
        lock: this.deps.lock?.(),
      }),
    };
  }

  private createOrderSource(
    connection: Connection,
    httpClient: IMiraklHttpClient,
    config: MiraklConnectionConfig,
    master: MiraklMasterServices
  ): MiraklOrderSourceAdapter {
    const carrierCodes = readMiraklCarrierCodes(config.carrierCodes);
    const acceptance = resolveMiraklOrderAcceptance(config.orderAcceptance);
    const settings = {
      brand: this.profile.brand,
      // A row written around the validator keeps the built-in table rather
      // than failing every dispatch.
      carrierCodes: carrierCodes.kind === 'valid' ? carrierCodes.codes : {},
      invoiceTypeCode: this.profile.invoiceDocumentTypeCode,
      catalogMaster: (connection.enabledCapabilities ?? []).includes('ProductMaster'),
      cache: master.cache,
    };
    // Only an explicit `true` sends refunds; anything else keeps recording them.
    if (config.refundsThroughMarketplace !== true) {
      return new MiraklOrderSourceAdapter(connection.id, httpClient, acceptance, settings);
    }
    return new MiraklRefundingOrderSourceAdapter(
      connection.id,
      httpClient,
      acceptance,
      settings,
      new MiraklRefundExecutor(
        connection.id,
        httpClient,
        this.profile.brand,
        this.profile.refundReasonCodes,
        master.cache
      )
    );
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort
  ): Promise<MiraklCredentials> {
    if (!connection.credentialsRef) {
      throw new MiraklConfigException(
        `${this.profile.brand} connection ${connection.id} is missing credentialsRef`,
        connection.id
      );
    }
    const credentials = await credentialsResolver.get<MiraklCredentials>(connection.credentialsRef);
    if (typeof credentials?.apiKey !== 'string' || credentials.apiKey.trim().length === 0) {
      throw new MiraklConfigException(
        `${this.profile.brand} connection ${connection.id} credentials are missing a non-empty apiKey`,
        connection.id
      );
    }
    return credentials;
  }

  private resolveShopId(
    connection: Connection,
    config: MiraklConnectionConfig
  ): string | undefined {
    const reading = readMiraklShopId(config.shopId);
    switch (reading.kind) {
      case 'absent':
        return undefined;
      case 'valid':
        return reading.shopId;
      case 'invalid':
        throw new MiraklConfigException(
          `${this.profile.brand} connection ${connection.id} has an invalid shopId (must be a positive integer)`,
          connection.id
        );
    }
  }
}
