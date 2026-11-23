/**
 * Mirakl Integration Module Builder
 *
 * Builds the NestJS host module for one Mirakl operator: the plugin, plus the
 * one piece of persistence the plugin owns, `mirakl_offer_writes` (#4277).
 *
 * The plugin descriptor is created when the module is defined, before DI runs,
 * so it cannot take the repository as a constructor argument. It gets a getter
 * instead, and the provider below fills it while Nest instantiates the module's
 * providers, which happens before `onModuleInit` registers the plugin and long
 * before any adapter is built.
 *
 * @module libs/integrations/mirakl/src
 */
import type { DynamicModule } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import type { Repository } from 'typeorm';
import type { MiraklOfferWriteRepositoryPort } from './domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOperatorProfile } from './domain/types/mirakl-operator-profile.types';
import { MiraklOfferWriteOrmEntity } from './infrastructure/persistence/entities/mirakl-offer-write.orm-entity';
import { MiraklOfferWriteRepository } from './infrastructure/persistence/repositories/mirakl-offer-write.repository';
import { createMiraklPlugin } from './mirakl-plugin';

export function createMiraklIntegrationModule(profile: MiraklOperatorProfile): DynamicModule {
  let offerWrites: MiraklOfferWriteRepositoryPort | undefined;
  const offerWritesToken = Symbol(`MiraklOfferWriteRepository:${profile.adapterKey}`);

  return createNestAdapterModule({
    plugin: createMiraklPlugin(profile, { offerWrites: () => offerWrites }),
    imports: [TypeOrmModule.forFeature([MiraklOfferWriteOrmEntity])],
    providers: [
      {
        provide: offerWritesToken,
        useFactory: (
          repository: Repository<MiraklOfferWriteOrmEntity>
        ): MiraklOfferWriteRepositoryPort => {
          offerWrites = new MiraklOfferWriteRepository(repository);
          return offerWrites;
        },
        inject: [getRepositoryToken(MiraklOfferWriteOrmEntity)],
      },
    ],
  });
}
