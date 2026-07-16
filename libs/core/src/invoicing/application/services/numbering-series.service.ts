/**
 * Numbering Series Service
 *
 * Application service for the invoice numbering-series module (#9/#10): series
 * CRUD + per-document-type routing. It is the single owner of pattern validation
 * and periodKey seeding — the HTTP controller delegates here and only maps domain
 * exceptions to status codes. Wraps the numbering-series repository port so the
 * API layer depends on an `I*Service` seam, not a `*RepositoryPort` (cross-context
 * contract). Allocation is NOT exposed — it stays in the repository +
 * `InvoiceService`. Country-agnostic (ADR-026).
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {INumberingSeriesService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { InvoiceNumberingSeriesNotFoundException } from '../../domain/exceptions/invoice-numbering-series-not-found.exception';
import type { InvoiceNumberingSeries } from '../../domain/entities/invoice-numbering-series.entity';
// Value import (not `import type`): injected via @Inject; surfaces in the
// constructor's decorator metadata.
import { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import {
  assertValidNumberingPattern,
  computePeriodKey,
} from '../../domain/numbering/invoice-number-pattern';
import { DEFAULT_NUMBERING_DOCUMENT_TYPE } from '../../domain/types/invoice-numbering.types';
import type {
  CreateNumberingSeriesServiceInput,
  ListNumberingSeriesFilter,
  SeriesRouteData,
  UpdateInvoiceNumberingSeriesInput,
  UpdateNumberingSeriesServiceInput,
  UpsertSeriesRouteInput,
} from '../../domain/types/invoice-numbering.types';
import { INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { INumberingSeriesService } from './numbering-series.service.interface';

@Injectable()
export class NumberingSeriesService implements INumberingSeriesService {
  constructor(
    @Inject(INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN)
    private readonly repository: InvoiceNumberingSeriesRepositoryPort,
  ) {}

  async createSeries(input: CreateNumberingSeriesServiceInput): Promise<InvoiceNumberingSeries> {
    assertValidNumberingPattern(input.pattern, input.resetPolicy);
    // Seed periodKey so the first allocation honours the configured nextSeq under
    // the chosen reset cadence.
    const periodKey = computePeriodKey(input.resetPolicy, new Date());
    return this.repository.createSeries({
      name: input.name,
      pattern: input.pattern,
      nextSeq: input.nextSeq,
      seqPadding: input.seqPadding,
      resetPolicy: input.resetPolicy,
      periodKey,
      documentType: input.documentType ?? DEFAULT_NUMBERING_DOCUMENT_TYPE,
      register: input.register ?? null,
    });
  }

  async getSeries(id: string): Promise<InvoiceNumberingSeries | null> {
    return this.repository.findSeriesById(id);
  }

  async listSeries(filter?: ListNumberingSeriesFilter): Promise<InvoiceNumberingSeries[]> {
    const all = await this.repository.listSeries();
    if (!filter) {
      return all;
    }
    return all.filter(
      (s) =>
        (filter.documentType === undefined || s.documentType === filter.documentType) &&
        (filter.register === undefined || s.register === filter.register),
    );
  }

  async listUnassignedSeries(): Promise<InvoiceNumberingSeries[]> {
    return this.repository.listUnassignedSeries();
  }

  async updateSeries(
    id: string,
    patch: UpdateNumberingSeriesServiceInput,
  ): Promise<InvoiceNumberingSeries> {
    const existing = await this.repository.findSeriesById(id);
    if (!existing) {
      throw new InvoiceNumberingSeriesNotFoundException(id);
    }

    const repoPatch: UpdateInvoiceNumberingSeriesInput = { ...patch };

    // Re-validate the EFFECTIVE (merged) pattern + reset policy whenever either
    // changes — otherwise a valid pattern could pair with an incompatible reset
    // cadence and re-render an already-issued number.
    if (patch.pattern !== undefined || patch.resetPolicy !== undefined) {
      const effectivePattern = patch.pattern ?? existing.pattern;
      const effectivePolicy = patch.resetPolicy ?? existing.resetPolicy;
      assertValidNumberingPattern(effectivePattern, effectivePolicy);
      // Reset policy changed → re-seed periodKey to the new cadence's current
      // period so rollover detection stays coherent.
      if (patch.resetPolicy !== undefined && patch.resetPolicy !== existing.resetPolicy) {
        repoPatch.periodKey = computePeriodKey(patch.resetPolicy, new Date());
      }
    }

    return this.repository.updateSeries(id, repoPatch);
  }

  async findRoutesByConnectionId(connectionId: string): Promise<SeriesRouteData[]> {
    return this.repository.findRoutesByConnectionId(connectionId);
  }

  async upsertRoute(input: UpsertSeriesRouteInput): Promise<SeriesRouteData> {
    return this.repository.upsertRoute(input);
  }

  async deleteRoute(
    connectionId: string,
    documentType: string,
    register: string | null,
  ): Promise<void> {
    return this.repository.deleteRoute(connectionId, documentType, register);
  }

  async seriesExists(id: string): Promise<boolean> {
    return (await this.repository.findSeriesById(id)) !== null;
  }
}
