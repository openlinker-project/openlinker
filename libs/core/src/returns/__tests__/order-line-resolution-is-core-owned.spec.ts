/**
 * `resolvedOrderLineId` is core-owned (#3171)
 *
 * Two structural guarantees, both easy to break by a later "while we're here"
 * edit, and both silent when broken.
 *
 * 1. **The column must never be echoed from a source payload.** It is
 *    core-resolved attribution; `UpsertReturnLineInput` deliberately has no
 *    member for it, and `upsertFromSource` excludes it from BOTH halves of its
 *    statement so a re-ingestion cannot move an answer core settled. Adding it
 *    to the upsert input would let an adapter assert which order line a return
 *    belongs to — the exact authority ADR-060 places above the source.
 *
 * 2. **Its write must stay a fill-in-when-NULL claim.** An unconditional
 *    `SET "resolvedOrderLineId"` would let a failed or later re-resolve
 *    un-resolve a line that already carried an answer.
 *
 * @module libs/core/src/returns/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...segments: string[]): string =>
  readFileSync(join(__dirname, '..', ...segments), 'utf8');

describe('resolvedOrderLineId ownership', () => {
  it('should keep the column out of the source-echoed upsert input', () => {
    const source = read('domain', 'types', 'return-upsert.types.ts');

    expect(source).not.toContain('resolvedOrderLineId');
  });

  it('should keep the column out of the ingestion line mapping', () => {
    // `toLineInput` maps `IncomingReturnLine` onto the upsert. A member here
    // would mean the source supplied the attribution.
    const source = read('application', 'services', 'returns.service.ts');
    const start = source.indexOf('private toLineInput(');
    expect(start).toBeGreaterThan(-1);

    // Sliced forward from the method, never between two `indexOf` results whose
    // order the file could change: `buildRawPayload` currently sits ABOVE
    // `toLineInput`, so a start/end pair would yield an empty string and pass
    // vacuously. A window that cannot invert is the point.
    const mapping = source.slice(start, source.indexOf('\n  }', start));
    expect(mapping).toContain('lineIndex');
    expect(mapping).not.toContain('resolvedOrderLineId');
  });

  it('should write the column only through a NULL-guarded claim', () => {
    const source = read(
      'infrastructure',
      'persistence',
      'repositories',
      'return.repository.ts'
    );

    const writes = source.match(/resolvedOrderLineId: orderLineId/g) ?? [];
    expect(writes).toHaveLength(1);

    const start = source.indexOf('async claimOrderLineResolution(');
    const end = source.indexOf("ReturnPersistenceError('claimOrderLineResolution'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(source.slice(start, end)).toContain('"resolvedOrderLineId" IS NULL');
  });
});
