/**
 * Amazon SQS Client (#4179)
 *
 * Reads and deletes messages on the operator's SQS queue, where Amazon SP-API
 * delivers notifications. Uses the SQS JSON protocol (`X-Amz-Target:
 * AmazonSQS.*`, `application/x-amz-json-1.0`) signed with SigV4
 * (`aws-sigv4.ts`) - no AWS SDK.
 *
 * Goes through the connection-bound transport like every other call for the
 * connection, follows no redirects and caps the body. A short long-poll keeps
 * one drain job from holding a worker slot.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { amazonTestOverride } from '../../amazon.constants';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonNetworkError } from '../../domain/exceptions/amazon-network.error';
import type { AmazonNotificationQueue } from '../../domain/types/amazon-config.types';
import { signAwsRequest, type AwsCredentials } from './aws-sigv4';
import { parseAmazonJson, readAmazonBody } from './amazon-response-body';

const REQUEST_TIMEOUT_MS = 30_000;
/** SQS answers at most 10 messages per receive and 10 entries per delete batch. */
export const SQS_MAX_BATCH = 10;
const WAIT_TIME_SECONDS = 5;

export interface SqsMessage {
  readonly MessageId: string;
  readonly ReceiptHandle: string;
  readonly Body?: string;
}

interface SqsErrorBody {
  readonly __type?: string;
  readonly message?: string;
}

export class AmazonSqsClient {
  constructor(
    private readonly queue: AmazonNotificationQueue,
    private readonly credentials: AwsCredentials,
    private readonly fetchImpl: FetchLike,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async receiveMessages(maxMessages: number): Promise<SqsMessage[]> {
    const response = await this.call<{ Messages?: SqsMessage[] }>('ReceiveMessage', {
      QueueUrl: this.queue.url,
      MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), SQS_MAX_BATCH),
      WaitTimeSeconds: WAIT_TIME_SECONDS,
    });
    return response.Messages ?? [];
  }

  async deleteMessages(receiptHandles: readonly string[]): Promise<void> {
    for (let start = 0; start < receiptHandles.length; start += SQS_MAX_BATCH) {
      const batch = receiptHandles.slice(start, start + SQS_MAX_BATCH);
      const result = await this.call<{ Failed?: { Id: string; Message?: string }[] }>('DeleteMessageBatch', {
        QueueUrl: this.queue.url,
        Entries: batch.map((handle, index) => ({ Id: String(index), ReceiptHandle: handle })),
      });
      if (result.Failed !== undefined && result.Failed.length > 0) {
        // Not deleted means delivered again later; the routed job dedups it.
        throw new AmazonNetworkError(
          `SQS did not delete ${String(result.Failed.length)} message(s): ${result.Failed[0].Message ?? 'no reason given'}`,
        );
      }
    }
  }

  private async call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    // Test seam (ignored in production): the fake SQS of the automated E2E.
    const url = `${amazonTestOverride('OL_AMAZON_SQS_BASE_URL') ?? `https://sqs.${this.queue.region}.amazonaws.com`}/`;
    const body = JSON.stringify(payload);
    const headers = signAwsRequest({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': `AmazonSQS.${action}`,
      },
      body,
      region: this.queue.region,
      service: 'sqs',
      credentials: this.credentials,
      now: this.now(),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readAmazonBody(response);
    } catch (error) {
      if (
        error instanceof RateLimitTimeoutError ||
        error instanceof RateLimitAbortedError ||
        error instanceof AmazonNetworkError
      ) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new AmazonNetworkError(
        controller.signal.aborted ? `SQS ${action} timed out` : `SQS ${action} failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      const error = parseAmazonJson<SqsErrorBody>(text);
      const code = error?.__type?.split('#').pop();
      throw new AmazonApiError(response.status, code, error?.message, response.headers.get('x-amzn-requestid') ?? undefined);
    }
    return parseAmazonJson<T>(text) ?? ({} as T);
  }
}
