/**
 * Shoper Flag Mapper
 *
 * Shoper serialises an on/off column as `"1"` / `"0"` (sometimes a real boolean
 * or number). One reader, so the status table, the parcel writeback and the
 * fulfilment read cannot disagree about what "off" looks like. No I/O.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */

/**
 * `true` / `false` for a value the shop sent, `undefined` when it sent none: an
 * absent flag stays absent rather than being guessed, and each caller decides
 * what absence means for it.
 */
export function readShoperFlag(value: string | number | boolean | null | undefined): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  return !(text === '0' || text === 'false' || text === '');
}
