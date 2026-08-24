/**
 * Tax-Rate Journal Service (#2250, ADR-063 § 4)
 *
 * Owns the one rule that keeps the journal a record of CHANGES rather than a
 * log of reads.
 *
 * @module libs/core/src/products/application/services
 * @implements {ITaxRateJournalService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { ITaxRateJournalService } from './tax-rate-journal.service.interface';
import { TAX_RATE_JOURNAL_REPOSITORY_TOKEN } from '../../products.tokens';
import { TaxRateJournalRepositoryPort } from '../../domain/ports/tax-rate-journal-repository.port';
import type {
  TaxRateJournalEntry,
  TaxRateObservation,
} from '../../domain/types/tax-rate-journal.types';
import { isNewTaxRateObservation } from '../../domain/types/tax-rate-journal.types';

@Injectable()
export class TaxRateJournalService implements ITaxRateJournalService {
  private readonly logger = new Logger(TaxRateJournalService.name);

  constructor(
    @Inject(TAX_RATE_JOURNAL_REPOSITORY_TOKEN)
    private readonly repository: TaxRateJournalRepositoryPort
  ) {}

  async record(observation: TaxRateObservation): Promise<TaxRateJournalEntry | null> {
    const latest = await this.repository.findLatest(
      observation.productId,
      observation.variantId,
      observation.connectionId
    );
    if (!isNewTaxRateObservation(latest, observation)) return null;

    const entry = await this.repository.append({
      ...observation,
      observedAt: observation.observedAt ?? new Date(),
    });
    this.logger.debug(
      `Tax-rate journal entry: productId=${observation.productId} ` +
        `variantId=${observation.variantId ?? 'none'} connectionId=${observation.connectionId} ` +
        `origin=${observation.origin} rate=${observation.taxRate ?? 'none'} ` +
        `frozen=${String(observation.frozen ?? false)}`
    );
    return entry;
  }

  async getLatestPerConnection(
    productId: string,
    variantId: string | null = null
  ): Promise<TaxRateJournalEntry[]> {
    return this.repository.findLatestPerConnection(productId, variantId);
  }
}
