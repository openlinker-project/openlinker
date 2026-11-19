/**
 * Amazon document transfer tests (#4184)
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import { gzipSync } from 'node:zlib';

import type { FetchLike } from '@openlinker/shared/http';

import { downloadAmazonDocument, safeAmazonDocumentUrl, uploadAmazonDocument } from '../amazon-document-transfer';

const respond = (body: Uint8Array | string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status: 200, headers });

describe('amazon document transfer', () => {
  it('should only follow HTTPS links on Amazon hosts', () => {
    expect(safeAmazonDocumentUrl('https://tortuga-prod-eu.s3.eu-west-1.amazonaws.com/x?sig=1', 'report')).toContain('amazonaws.com');
    expect(() => safeAmazonDocumentUrl('http://s3.amazonaws.com/x', 'report')).toThrow();
    expect(() => safeAmazonDocumentUrl('https://169.254.169.254/latest', 'report')).toThrow();
    expect(() => safeAmazonDocumentUrl('https://evil.example.com/amazonaws.com', 'report')).toThrow();
  });

  it('should gunzip a compressed document and decode its charset', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      respond(gzipSync(Buffer.from('Zwrot\tŁódź', 'utf-8')), { 'content-type': 'text/plain; charset=UTF-8' }),
    ) as unknown as FetchLike;

    await expect(downloadAmazonDocument(fetchImpl, 'https://x.s3.amazonaws.com/d', 'GZIP', 'report')).resolves.toBe('Zwrot\tŁódź');
  });

  it('should decode a Latin-1 report', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      respond(Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]), { 'content-type': 'text/plain; charset=iso-8859-1' }),
    ) as unknown as FetchLike;

    await expect(downloadAmazonDocument(fetchImpl, 'https://x.s3.amazonaws.com/d', undefined, 'report')).resolves.toBe('Müller');
  });

  it('should upload with the content type and refuse a failed upload', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 403 })) as unknown as FetchLike;

    await expect(
      uploadAmazonDocument(fetchImpl, 'https://x.s3.amazonaws.com/u', 'a\tb', 'text/tab-separated-values', 'feed'),
    ).rejects.toThrow(/upload failed/);
    expect(fetchImpl).toHaveBeenCalledWith('https://x.s3.amazonaws.com/u', expect.objectContaining({ method: 'PUT', body: 'a\tb' }));
  });
});
