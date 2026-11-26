/**
 * Amazon Feeds Client (#4184)
 *
 * Feeds API v2021-06-30: create a feed document, upload its content to the
 * presigned link, submit the feed, read its status and its processing report.
 * Amazon processes a feed asynchronously; `DONE` means processed, and the
 * processing report says which records it accepted.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';

import type {
  AmazonCreateFeedDocumentResponse,
  AmazonCreateFeedResponse,
  AmazonDocumentLink,
  AmazonFeed,
} from '../../domain/types/amazon-reports-feeds.types';
import type { AmazonSpApiClient } from './amazon-spapi-client';
import { downloadAmazonDocument, uploadAmazonDocument } from './amazon-document-transfer';

const FEEDS_PATH = '/feeds/2021-06-30';

export class AmazonFeedsClient {
  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly fetchImpl: FetchLike,
  ) {}

  /** Creates the document and uploads `content`; returns the document id. Nothing is processed yet. */
  async uploadFeedDocument(content: string, contentType: string): Promise<string> {
    const response = await this.client.post<AmazonCreateFeedDocumentResponse>(`${FEEDS_PATH}/documents`, {
      contentType,
    });
    await uploadAmazonDocument(this.fetchImpl, response.data.url, content, contentType, 'feed document');
    return response.data.feedDocumentId;
  }

  /** Submits the feed: from here Amazon may act on it. */
  async createFeed(feedType: string, marketplaceIds: readonly string[], inputFeedDocumentId: string): Promise<string> {
    const response = await this.client.post<AmazonCreateFeedResponse>(`${FEEDS_PATH}/feeds`, {
      feedType,
      marketplaceIds,
      inputFeedDocumentId,
    });
    return response.data.feedId;
  }

  async getFeed(feedId: string): Promise<AmazonFeed> {
    const response = await this.client.get<AmazonFeed>(`${FEEDS_PATH}/feeds/${encodeURIComponent(feedId)}`);
    return response.data;
  }

  async downloadResult(resultFeedDocumentId: string): Promise<string> {
    const response = await this.client.get<AmazonDocumentLink>(
      `${FEEDS_PATH}/documents/${encodeURIComponent(resultFeedDocumentId)}`,
    );
    return downloadAmazonDocument(this.fetchImpl, response.data.url, response.data.compressionAlgorithm, 'feed processing report');
  }
}
