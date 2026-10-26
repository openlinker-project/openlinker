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
 * Every scan here reads CODE, never prose — see `stripComments` below.
 *
 * @module libs/core/src/returns/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strip comments before scanning.
 *
 * Each file this guard protects NAMES the column in a docblock in order to say
 * the source may not supply it — `UpsertReturnLineInput`'s own docblock lists it
 * among the columns absent by construction, which is exactly the explanation a
 * future reader needs, and is what the first version of this guard failed on.
 * Scanning code only keeps the teeth (a real member or an unguarded write still
 * fails) without forcing the files to go quiet about the one property that
 * matters most about them.
 *
 * Deliberately a crude strip rather than a parse: it can only ever remove MORE
 * than a real comment, and over-removal would make the guard miss a violation —
 * so the risk is checked by the self-test below, which feeds it lines that are
 * code and must survive.
 *
 * @see `proposal-never-issues.spec.ts`, which reached the same shape for the
 *      same reason.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const readCode = (...segments: string[]): string =>
  stripComments(readFileSync(join(__dirname, '..', ...segments), 'utf8'));

describe('resolvedOrderLineId ownership', () => {
  it('should still see the column when it is real code, not a comment', () => {
    // Self-check: proves the comment strip has not blinded the guard.
    expect(stripComments('  resolvedOrderLineId: string | null;')).toContain(
      'resolvedOrderLineId'
    );
    expect(stripComments('.set({ resolvedOrderLineId: orderLineId })')).toContain(
      'resolvedOrderLineId: orderLineId'
    );
    expect(stripComments('// never echoes resolvedOrderLineId')).not.toContain(
      'resolvedOrderLineId'
    );
    expect(
      stripComments('/**\n * `resolvedOrderLineId` is absent by construction.\n */')
    ).not.toContain('resolvedOrderLineId');
  });

  it('should keep the column out of the source-echoed upsert input', () => {
    const source = readCode('domain', 'types', 'return-upsert.types.ts');

    expect(source).not.toContain('resolvedOrderLineId');
  });

  it('should keep the column out of the ingestion line mapping', () => {
    // `toLineInput` maps `IncomingReturnLine` onto the upsert. A member here
    // would mean the source supplied the attribution.
    const source = readCode('application', 'services', 'returns.service.ts');
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
    const source = readCode(
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
