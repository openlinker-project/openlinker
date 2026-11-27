/**
 * CSV writer primitives (#3589, G11-H)
 *
 * Server-side CSV for report exports: comma delimiter, UTF-8 BOM, CRLF line
 * endings, `# key: value` comment lines ahead of the header row. Formula
 * injection (`= + - @ \t \r` leading a cell) is neutralised for STRING cells
 * only: a legitimate negative number must never be prefixed.
 *
 * @module libs/shared/src/csv
 */
import { Readable } from 'node:stream';

export type CsvCellValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  readonly header: string;
  readonly value: (row: Row) => CsvCellValue;
}

export interface CsvHeaderCommentEntry {
  readonly key: string;
  readonly value: string;
}

export interface CsvStreamOptions {
  /** Defaults to `,`. */
  readonly delimiter?: string;
  /** Prepend a UTF-8 BOM so Excel detects the encoding. Defaults to `true`. */
  readonly bom?: boolean;
  /** Lines emitted before the header row, from {@link csvHeaderComments}. */
  readonly comments?: readonly string[];
}

const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;
const UTF8_BOM = '﻿';
const LINE_END = '\r\n';

export function csvCell(value: CsvCellValue, delimiter = ','): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value);
  const guarded = typeof value === 'string' && FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
  const needsQuoting =
    guarded.includes('"') ||
    guarded.includes('\r') ||
    guarded.includes('\n') ||
    guarded.includes(delimiter);
  return needsQuoting ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** `# key: value` lines; line breaks inside a value are collapsed so a comment stays one line. */
export function csvHeaderComments(entries: readonly CsvHeaderCommentEntry[]): string[] {
  return entries.map(({ key, value }) => `# ${key}: ${value.replace(/[\r\n]+/g, ' ')}`);
}

export function csvLine(cells: readonly CsvCellValue[], delimiter = ','): string {
  return cells.map((cell) => csvCell(cell, delimiter)).join(delimiter);
}

export function csvStream<Row>(
  columns: readonly CsvColumn<Row>[],
  rows: Iterable<Row> | AsyncIterable<Row>,
  options: CsvStreamOptions = {}
): Readable {
  const delimiter = options.delimiter ?? ',';
  const bom = options.bom ?? true;
  const comments = options.comments ?? [];

  async function* generate(): AsyncGenerator<string> {
    const head = [
      ...comments,
      csvLine(
        columns.map((column) => column.header),
        delimiter
      ),
    ];
    yield (bom ? UTF8_BOM : '') + head.join(LINE_END) + LINE_END;
    for await (const row of rows) {
      yield csvLine(
        columns.map((column) => column.value(row)),
        delimiter
      ) + LINE_END;
    }
  }

  return Readable.from(generate(), { objectMode: false });
}
