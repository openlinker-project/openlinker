/**
 * Amazon Credentials Policy
 *
 * The one reader of stored Amazon credentials, shared by the shape validator
 * and the token provider so a save accepts exactly what a job can use (the
 * `resolveShopifyCredentialMode` shape).
 *
 * Both sources - a self-authorized private app and a public-app OAuth grant -
 * store the same three LWA values; `source` only records which one it was.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import {
  AmazonCredentialSourceValues,
  type AmazonCredentialSource,
  type AmazonCredentials,
} from '../types/amazon-credentials.types';

export type AmazonCredentialsParseResult =
  | { readonly ok: true; readonly credentials: AmazonCredentials; readonly source: AmazonCredentialSource }
  | { readonly ok: false; readonly issues: readonly string[] };

const REQUIRED_FIELDS = ['clientId', 'clientSecret', 'refreshToken'] as const;

export function parseAmazonCredentials(raw: Record<string, unknown> | null | undefined): AmazonCredentialsParseResult {
  const value = raw ?? {};
  const issues: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const entry = value[field];
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issues.push(`must include a non-empty \`${field}\` string`);
    }
  }

  const rawSource = value.source;
  let source: AmazonCredentialSource = 'self-authorized';
  if (rawSource !== undefined) {
    if (typeof rawSource === 'string' && (AmazonCredentialSourceValues as readonly string[]).includes(rawSource)) {
      source = rawSource as AmazonCredentialSource;
    } else {
      issues.push(`\`source\` must be one of: ${AmazonCredentialSourceValues.join(', ')}`);
    }
  }

  if (value.sellingPartnerId !== undefined && typeof value.sellingPartnerId !== 'string') {
    issues.push('`sellingPartnerId` must be a string when present');
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    source,
    credentials: {
      clientId: (value.clientId as string).trim(),
      clientSecret: (value.clientSecret as string).trim(),
      refreshToken: (value.refreshToken as string).trim(),
      source,
      ...(typeof value.sellingPartnerId === 'string' ? { sellingPartnerId: value.sellingPartnerId } : {}),
    },
  };
}
