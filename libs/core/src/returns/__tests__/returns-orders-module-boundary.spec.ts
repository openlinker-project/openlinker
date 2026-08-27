/**
 * The `returns` ↔ `orders` module boundary, asserted (#2645 review)
 *
 * `ReturnsModule` deliberately does NOT import `OrdersModule`. That rule is
 * explained well — in four separate docblocks across `returns.module.ts`,
 * `returns/index.ts` and two service interfaces — and until now it was **prose
 * with no mechanism behind it**.
 *
 * ## Why the existing guards do not catch it
 *
 * Nothing in the toolchain would fail on adding the import:
 *
 * - `scripts/check-cross-context-imports.mjs` **allows** `*Module` as a
 *   cross-context symbol shape, and correctly so — a module class imported for
 *   `imports: [...]` is a legitimate composition edge everywhere else in core.
 * - `returns` is correctly absent from the barrel spec's
 *   `ZERO_SIBLING_EDGE_LEAVES`, because it genuinely has five sibling edges.
 * - `returns` already imports the `orders` BARREL for types and tokens, so an
 *   import-list grep cannot distinguish the legal type edge from the illegal
 *   module edge.
 *
 * So the guard has to read the `imports:` array itself. This is the
 * `no-second-proposal-mechanism.spec.ts` shape: an acceptance criterion the
 * codebase asserts about itself rather than trusting a reviewer to re-derive.
 *
 * ## What breaking it costs
 *
 * `OrdersModule` imports seven siblings this context has no business carrying,
 * and `orders` imports the returns barrel — so the "for symmetry" edit that
 * looks tidiest is the one that manufactures a runtime CJS cycle. The correct
 * home for anything needing both is the INTERFACE layer, where
 * `ReturnsReadApiModule` and `ReturnActionsApiModule` already hold the edge.
 *
 * @module returns/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RETURNS_ROOT = join(__dirname, '..');
const ORDERS_ROOT = join(__dirname, '..', '..', 'orders');

/**
 * The `imports: [...]` array of a NestJS `@Module` decorator, as source text.
 *
 * Read from the decorator rather than from the file's import statements, which
 * is the whole point: the illegal edge and the legal type-only edge are the
 * same `import` line.
 */
function moduleImportsBlock(source: string): string {
  const start = source.indexOf('imports: [');
  if (start === -1) return '';

  let depth = 0;
  for (let i = source.indexOf('[', start); i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/** Strip comments — a module named in prose is not a module edge. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the returns ↔ orders module boundary', () => {
  it('should keep OrdersModule OUT of ReturnsModule.imports', () => {
    const source = readFileSync(join(RETURNS_ROOT, 'returns.module.ts'), 'utf8');
    const imports = withoutComments(moduleImportsBlock(source));

    expect(imports).not.toBe('');
    // `OrderChangesModule` — the LEAF that `returns` legitimately imports — must
    // not satisfy or trip this assertion, so the match is anchored on the exact
    // identifier rather than a substring.
    expect(/\bOrdersModule\b/.test(imports)).toBe(false);
  });

  it('should keep ReturnsModule OUT of OrdersModule.imports, so the edge stays one-way', () => {
    const source = readFileSync(join(ORDERS_ROOT, 'orders.module.ts'), 'utf8');
    const imports = withoutComments(moduleImportsBlock(source));

    expect(imports).not.toBe('');
    expect(/\bReturnsModule\b/.test(imports)).toBe(false);
  });

  it('should still permit the LEAF order-changes edge the authorize path depends on', () => {
    // A guard that also banned this would be wrong, and someone would delete it.
    const source = readFileSync(join(RETURNS_ROOT, 'returns.module.ts'), 'utf8');
    const imports = withoutComments(moduleImportsBlock(source));

    expect(/\bOrderChangesModule\b/.test(imports)).toBe(true);
  });
});
