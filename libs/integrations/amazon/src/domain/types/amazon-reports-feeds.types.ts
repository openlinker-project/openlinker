/**
 * Amazon Reports and Feeds Wire Types (#4184)
 *
 * The subset of Reports API v2021-06-30 and Feeds API v2021-06-30 the returns
 * reader and the refund executor use, from Amazon's published models.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export const AmazonProcessingStatusValues = ['IN_QUEUE', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'FATAL'] as const;
export type AmazonProcessingStatus = (typeof AmazonProcessingStatusValues)[number];

export interface AmazonCreateReportResponse {
  readonly reportId: string;
}

export interface AmazonReport {
  readonly reportId: string;
  readonly processingStatus: AmazonProcessingStatus;
  readonly reportDocumentId?: string;
  /** ISO 8601. */
  readonly processingEndTime?: string;
}

export interface AmazonDocumentLink {
  readonly reportDocumentId?: string;
  readonly feedDocumentId?: string;
  readonly url: string;
  /** `GZIP` when the document is compressed. */
  readonly compressionAlgorithm?: string;
}

export interface AmazonCreateFeedDocumentResponse {
  readonly feedDocumentId: string;
  readonly url: string;
}

export interface AmazonCreateFeedResponse {
  readonly feedId: string;
}

export interface AmazonFeed {
  readonly feedId: string;
  readonly processingStatus: AmazonProcessingStatus;
  readonly resultFeedDocumentId?: string;
  /** ISO 8601. */
  readonly processingEndTime?: string;
}
