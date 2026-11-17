/**
 * AWS Signature Version 4
 *
 * Signs a request to an AWS service (the SQS queue Amazon SP-API delivers
 * notifications to, #4179). Implemented here rather than pulling in the AWS
 * SDK: one pure function over `node:crypto`, checked against AWS's own
 * published example (`aws-sigv4.spec.ts`).
 *
 * Only what SQS's JSON protocol needs: the signed headers are `host`,
 * `x-amz-date` and every header the caller passes (lower-cased, sorted), and
 * the payload is hashed in full. The secret never leaves this function.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface AwsSignInput {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: AwsCredentials;
  readonly now: Date;
}

/** Returns the headers to send: the caller's, plus `host`, `x-amz-date` and `authorization`. */
export function signAwsRequest(input: AwsSignInput): Record<string, string> {
  const url = new URL(input.url);
  const amzDate = toAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers.host = url.host;
  headers['x-amz-date'] = amzDate;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = [dateStamp, input.region, input.service, 'aws4_request'].reduce<Buffer>(
    (key, part) => hmac(key, part),
    Buffer.from(`AWS4${input.credentials.secretAccessKey}`, 'utf8'),
  );
  const signature = hmac(signingKey, stringToSign).toString('hex');

  return {
    ...input.headers,
    host: url.host,
    'x-amz-date': amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function canonicalPath(pathname: string): string {
  if (pathname.length === 0) {
    return '/';
  }
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}
