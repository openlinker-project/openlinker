/**
 * Mirakl Error Report Parser
 *
 * Turns an import error report into neutral line errors. The reports are CSV
 * in more than one dialect, both seen on Empik staging:
 *
 * - OF03 (offers): every cell double-quoted, the reason in `error-message`,
 *   the line number in `error-line`, the SKU in `sku`.
 * - STO03 (stock): unquoted, `line-number;errors;offer-sku;quantity`.
 *
 * Columns are found by header name, never by position, so a report with extra
 * or reordered columns still reads. A report whose header names no reason
 * column falls back to the last column whose name contains "error".
 *
 * @module libs/integrations/mirakl/src/infrastructure/imports
 */
import type { MiraklImportLineError } from '../../domain/types/mirakl-import.types';

const REASON_COLUMNS = ['error-message', 'errors', 'error', 'error-reason', 'message'];
const LINE_COLUMNS = ['error-line', 'line-number', 'line'];
const SKU_COLUMNS = ['sku', 'offer-sku', 'shop-sku', 'product-sku', 'shop_sku'];

/**
 * @param keyColumns further columns that name the line, matched before the SKU
 * columns, lower-cased (a P41 report names a card by its catalogue code).
 */
export function parseMiraklErrorReport(
  csv: string,
  keyColumns: readonly string[] = []
): MiraklImportLineError[] {
  const text = csv.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length < 2) {
    return [];
  }
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const reasonIndex = findColumn(header, REASON_COLUMNS) ?? findLastErrorColumn(header);
  if (reasonIndex === undefined) {
    return [];
  }
  const lineIndex = findColumn(header, LINE_COLUMNS);
  const skuIndex = findColumn(header, [
    ...keyColumns.map((name) => name.toLowerCase()),
    ...SKU_COLUMNS,
  ]);

  const errors: MiraklImportLineError[] = [];
  for (const row of rows.slice(1)) {
    const reason = (row[reasonIndex] ?? '').trim();
    if (reason === '') {
      continue;
    }
    const line = lineIndex === undefined ? undefined : toLineNumber(row[lineIndex]);
    const sku = skuIndex === undefined ? undefined : (row[skuIndex] ?? '').trim() || undefined;
    errors.push({
      reason,
      ...(line === undefined ? {} : { line }),
      ...(sku === undefined ? {} : { sku }),
    });
  }
  return errors;
}

function findColumn(header: readonly string[], names: readonly string[]): number | undefined {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index !== -1) {
      return index;
    }
  }
  return undefined;
}

function findLastErrorColumn(header: readonly string[]): number | undefined {
  for (let index = header.length - 1; index >= 0; index--) {
    if (header[index].includes('error')) {
      return index;
    }
  }
  return undefined;
}

function toLineNumber(cell: string | undefined): number | undefined {
  const value = Number((cell ?? '').trim());
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Minimal RFC 4180 reader: quoted cells, `""` as an escaped quote, delimiters
 * and line breaks inside quotes. Enough for Mirakl's reports; not a general
 * CSV library.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
