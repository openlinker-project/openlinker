/**
 * Sales Document Setting Repository Port (#3941)
 *
 * Persistence contract for the singleton sales-document settings row.
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
export interface SalesDocumentSettingRecord {
  /** NULL = not set. Stored as text; narrowed by the service on read. */
  giftDocumentForm: string | null;
  /** NULL unless the form is `custom-price`. */
  giftDocumentUnitPrice: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SalesDocumentSettingRepositoryPort {
  findSetting(): Promise<SalesDocumentSettingRecord | null>;
  upsertGiftDocumentForm(
    form: string | null,
    unitPrice: string | null,
    updatedBy: string | null,
  ): Promise<SalesDocumentSettingRecord>;
}
