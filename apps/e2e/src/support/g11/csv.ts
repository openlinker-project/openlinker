/**
 * CSV parsing for the G11 export checks (#3591)
 *
 * Understands exactly the file the API writes: UTF-8 BOM, `# key: value`
 * comment lines before the header, then RFC 4180 rows with CRLF endings. A
 * formula-guarded cell keeps its leading apostrophe (that is the point of
 * CSV-4), so cells are returned verbatim.
 *
 * @module support/g11
 */
export interface ParsedCsv {
  hasBom: boolean;
  /** Raw `# ...` lines, without the leading `# `. */
  commentLines: string[];
  /** `key -> value` from the `# key: value` lines. */
  comments: Record<string, string>;
  header: string[];
  rows: Array<Record<string, string>>;
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(buffer: Buffer): ParsedCsv {
  const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = buffer.subarray(hasBom ? 3 : 0).toString('utf8');
  const lines = text.split(/\r\n|\n/);
  const commentLines: string[] = [];
  let index = 0;
  while (index < lines.length && (lines[index] ?? '').startsWith('#')) {
    commentLines.push((lines[index] ?? '').replace(/^#\s?/, ''));
    index += 1;
  }
  const comments: Record<string, string> = {};
  for (const line of commentLines) {
    const colon = line.indexOf(':');
    if (colon > 0) comments[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const records = parseRecords(lines.slice(index).join('\r\n')).filter((r) => !(r.length === 1 && r[0] === ''));
  const header = records[0] ?? [];
  const rows = records.slice(1).map((record) => {
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = record[i] ?? '';
    });
    return row;
  });
  return { hasBom, commentLines, comments, header, rows };
}
