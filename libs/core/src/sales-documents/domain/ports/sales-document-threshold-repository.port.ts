/**
 * Sales-Document Threshold Repository Port (#2170)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentThreshold } from '../entities/sales-document-threshold.entity';
import type { SalesDocumentThresholdInput } from '../types/sales-document-rule-write.types';

export interface SalesDocumentThresholdRepositoryPort {
  findAll(): Promise<SalesDocumentThreshold[]>;

  findByRef(ref: string): Promise<SalesDocumentThreshold | null>;

  findByRefs(refs: readonly string[]): Promise<SalesDocumentThreshold[]>;

  create(input: SalesDocumentThresholdInput): Promise<SalesDocumentThreshold>;
}
