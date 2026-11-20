/**
 * AmazonSqsClient tests (#4179)
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonNetworkError } from '../../../domain/exceptions/amazon-network.error';
import { AmazonSqsClient } from '../amazon-sqs-client';

const QUEUE = {
  url: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
  region: 'eu-west-1',
  arn: 'arn:aws:sqs:eu-west-1:123456789012:amazon-notifications',
};
const CREDENTIALS = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-example' };
const NOW = (): Date => new Date('2026-11-17T12:00:00Z');

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

describe('AmazonSqsClient', () => {
  it('should receive messages with a signed JSON-protocol request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, { Messages: [{ MessageId: 'm1', ReceiptHandle: 'h1', Body: '{}' }] }));
    const client = new AmazonSqsClient(QUEUE, CREDENTIALS, fetchImpl, NOW);

    const messages = await client.receiveMessages(50);

    expect(messages).toEqual([{ MessageId: 'm1', ReceiptHandle: 'h1', Body: '{}' }]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://sqs.eu-west-1.amazonaws.com/');
    expect(init.headers['x-amz-target']).toBe('AmazonSQS.ReceiveMessage');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261117\/eu-west-1\/sqs\/aws4_request/);
    expect(JSON.parse(String(init.body))).toEqual({ QueueUrl: QUEUE.url, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 });
    expect(init.redirect).toBe('manual');
  });

  it('should answer an empty queue with no messages', async () => {
    const client = new AmazonSqsClient(QUEUE, CREDENTIALS, jest.fn().mockResolvedValue(json(200, {})), NOW);
    await expect(client.receiveMessages(10)).resolves.toEqual([]);
  });

  it('should delete in batches of ten', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => Promise.resolve(json(200, { Successful: [] })));
    const client = new AmazonSqsClient(QUEUE, CREDENTIALS, fetchImpl, NOW);

    await client.deleteMessages(Array.from({ length: 12 }, (_, i) => `h${String(i)}`));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body)) as { Entries: unknown[] };
    expect(second.Entries).toEqual([
      { Id: '0', ReceiptHandle: 'h10' },
      { Id: '1', ReceiptHandle: 'h11' },
    ]);
  });

  it('should report a partly failed delete', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, { Failed: [{ Id: '0', Message: 'expired handle' }] }));
    const client = new AmazonSqsClient(QUEUE, CREDENTIALS, fetchImpl, NOW);
    await expect(client.deleteMessages(['h'])).rejects.toBeInstanceOf(AmazonNetworkError);
  });

  it('should carry the SQS error code on a refusal', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      json(400, { __type: 'com.amazonaws.sqs#AccessDenied', message: 'not allowed' }),
    );
    const client = new AmazonSqsClient(QUEUE, CREDENTIALS, fetchImpl, NOW);
    const error = await client.receiveMessages(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmazonApiError);
    expect(error).toMatchObject({ statusCode: 400, errorCode: 'AccessDenied' });
  });
});
