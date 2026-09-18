/**
 * Sales-Document List Cursor Codec (#3306)
 *
 * `SalesDocumentListCursor` carries per-source `null` (exhausted) /
 * `undefined` (not yet started) / a concrete `{createdAt, id}` position.
 * `JSON.stringify` already drops `undefined`-valued keys and keeps explicit
 * `null`s, which is exactly the round-trip this cursor needs - so the codec is
 * deliberately thin: base64 the JSON, and revive `createdAt` back into a
 * `Date` on the way in (JSON has no date type).
 *
 * An unreadable cursor is a caller error, not a server one - throws
 * `BadRequestException` rather than silently restarting the walk, which would
 * make a corrupted cursor look like "no more results" or "from the start"
 * depending on which half survived.
 *
 * @module apps/api/src/orders/http
 */
import { BadRequestException } from '@nestjs/common';
import type { SalesDocumentListCursor } from '@openlinker/core/orders';

export function encodeSalesDocumentListCursor(
  cursor: SalesDocumentListCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSalesDocumentListCursor(
  raw: string | undefined,
): SalesDocumentListCursor | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Malformed cursor');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BadRequestException('Malformed cursor');
  }
  const record = parsed as Record<string, unknown>;
  return {
    invoice: revive(record['invoice']),
    fiscal: revive(record['fiscal']),
  };
}

function revive(value: unknown): { createdAt: Date; id: string } | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (
    typeof value !== 'object' ||
    typeof (value as { createdAt?: unknown }).createdAt !== 'string' ||
    typeof (value as { id?: unknown }).id !== 'string'
  ) {
    throw new BadRequestException('Malformed cursor');
  }
  const createdAt = new Date((value as { createdAt: string }).createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Malformed cursor');
  }
  return { createdAt, id: (value as { id: string }).id };
}
