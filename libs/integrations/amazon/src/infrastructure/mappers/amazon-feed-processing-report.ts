/**
 * Amazon Feed Processing Report (#4184)
 *
 * Reads what Amazon did with a submitted feed. A flat-file feed gets a text
 * report ("Number of records processed / successful" and a tab-separated table
 * of errors); a JSON feed gets a JSON report with a summary and issues. Both
 * are read into the same counts and messages. A report this reader cannot make
 * sense of reports no counts, which the caller treats as not knowing.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import { parseAmazonFlatFile } from './amazon-flat-file';

export interface AmazonFeedProcessingSummary {
  readonly processed: number | null;
  readonly successful: number | null;
  /** Amazon's error messages, verbatim. */
  readonly errors: readonly string[];
}

export function readAmazonFeedProcessingReport(text: string): AmazonFeedProcessingSummary {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return readJson(trimmed);
  }
  const processed = count(/records processed\D*(\d+)/i, trimmed);
  const successful = count(/records successful\D*(\d+)/i, trimmed);
  const lines = trimmed.split(/\r?\n/);
  const tableStart = lines.findIndex((line) => /error-message|error message/i.test(line));
  const errors =
    tableStart < 0
      ? []
      : parseAmazonFlatFile(lines.slice(tableStart).join('\n'))
          .filter((row) => (row.errortype ?? 'Error').toLowerCase() === 'error')
          .map((row) => row.errormessage ?? '')
          .filter((message) => message.length > 0);
  return { processed, successful, errors };
}

function readJson(text: string): AmazonFeedProcessingSummary {
  try {
    const report = JSON.parse(text) as {
      summary?: { messagesProcessed?: number; messagesAccepted?: number; errors?: number };
      issues?: Array<{ severity?: string; message?: string }>;
    };
    const errors = (report.issues ?? [])
      .filter((issue) => (issue.severity ?? '').toUpperCase() === 'ERROR')
      .map((issue) => issue.message ?? '')
      .filter((message) => message.length > 0);
    return {
      processed: report.summary?.messagesProcessed ?? null,
      successful: report.summary?.messagesAccepted ?? null,
      errors,
    };
  } catch {
    return { processed: null, successful: null, errors: [] };
  }
}

function count(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}
