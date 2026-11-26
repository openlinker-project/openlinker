/**
 * Amazon Flat File (#4184)
 *
 * Reads and writes Amazon's tab-separated flat files. Report headers are
 * matched by a normalised name (lower case, letters and digits only), so
 * `Amazon RMA ID`, `amazon-rma-id` and `amazon_rma_id` are the same column:
 * Amazon's column titles differ between report versions and marketplaces.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */

export type AmazonFlatFileRow = Readonly<Record<string, string>>;

export function normaliseFlatFileHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Rows keyed by normalised header. Blank lines are skipped; a short row fills the missing cells with ''. */
export function parseAmazonFlatFile(text: string): AmazonFlatFileRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const headers = lines[0].split('\t').map(normaliseFlatFileHeader);
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header.length > 0) {
        row[header] = (cells[index] ?? '').trim();
      }
    });
    return row;
  });
}

/** A flat file from a header row and rows; tabs and line breaks inside a value are replaced by spaces. */
export function writeAmazonFlatFile(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const clean = (value: string): string => value.replace(/[\t\r\n]+/g, ' ');
  return [headers, ...rows].map((row) => row.map(clean).join('\t')).join('\n') + '\n';
}
