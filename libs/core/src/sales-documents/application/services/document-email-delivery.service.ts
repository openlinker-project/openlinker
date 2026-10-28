/**
 * Document Email Delivery Service (#3550)
 *
 * @module libs/core/src/sales-documents/application/services
 * @implements {IDocumentEmailDeliveryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { getEnvBoolean } from '@openlinker/shared/config';
import type { DocumentEmailDelivery } from '../../domain/entities/document-email-delivery.entity';
import {
  DocumentEmailDeliveryRepositoryPort,
  type RecordDocumentEmailDeliveryInput,
} from '../../domain/ports/document-email-delivery-repository.port';
import { DOCUMENT_EMAIL_DELIVERY_REPOSITORY_TOKEN } from '../../sales-documents.tokens';
import type { IDocumentEmailDeliveryService } from '../interfaces/document-email-delivery.service.interface';

/** The timeline shows recent sends; an order is not emailed hundreds of times. */
export const DOCUMENT_EMAIL_LIST_LIMIT = 50;

@Injectable()
export class DocumentEmailDeliveryService implements IDocumentEmailDeliveryService {
  private readonly logger = new Logger(DocumentEmailDeliveryService.name);

  constructor(
    @Inject(DOCUMENT_EMAIL_DELIVERY_REPOSITORY_TOKEN)
    private readonly repository: DocumentEmailDeliveryRepositoryPort
  ) {}

  async record(input: RecordDocumentEmailDeliveryInput): Promise<DocumentEmailDelivery | null> {
    try {
      return await this.repository.record({
        ...input,
        recipient: getEnvBoolean('OL_STORE_PII', true) ? input.recipient : null,
      });
    } catch (error) {
      this.logger.error(
        `Could not record a document email delivery: order=${input.internalOrderId} ` +
          `document=${input.documentId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      return null;
    }
  }

  listForOrder(internalOrderId: string): Promise<DocumentEmailDelivery[]> {
    return this.repository.listByOrder(internalOrderId, DOCUMENT_EMAIL_LIST_LIMIT);
  }
}
