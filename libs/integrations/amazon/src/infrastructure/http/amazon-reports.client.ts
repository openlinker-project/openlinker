/**
 * Amazon Reports Client (#4184)
 *
 * Reports API v2021-06-30: request a report, read its status, download its
 * document. Amazon builds a report asynchronously (minutes), so a caller
 * requests it on one run and reads it on a later one.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';

import type {
  AmazonCreateReportResponse,
  AmazonDocumentLink,
  AmazonReport,
} from '../../domain/types/amazon-reports-feeds.types';
import type { AmazonSpApiClient } from './amazon-spapi-client';
import { downloadAmazonDocument } from './amazon-document-transfer';

const REPORTS_PATH = '/reports/2021-06-30';

export interface AmazonReportRequest {
  readonly reportType: string;
  readonly marketplaceIds: readonly string[];
  /** ISO 8601. */
  readonly dataStartTime: string;
  /** ISO 8601. */
  readonly dataEndTime: string;
}

export class AmazonReportsClient {
  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly fetchImpl: FetchLike,
  ) {}

  async createReport(request: AmazonReportRequest): Promise<string> {
    const response = await this.client.post<AmazonCreateReportResponse>(`${REPORTS_PATH}/reports`, request);
    return response.data.reportId;
  }

  async getReport(reportId: string): Promise<AmazonReport> {
    const response = await this.client.get<AmazonReport>(`${REPORTS_PATH}/reports/${encodeURIComponent(reportId)}`);
    return response.data;
  }

  /** The document's text. The link Amazon returns expires after minutes, so it is fetched on every call. */
  async downloadDocument(reportDocumentId: string): Promise<string> {
    const response = await this.client.get<AmazonDocumentLink>(
      `${REPORTS_PATH}/documents/${encodeURIComponent(reportDocumentId)}`,
    );
    return downloadAmazonDocument(this.fetchImpl, response.data.url, response.data.compressionAlgorithm, 'report document');
  }
}
