/**
 * Every `features/oms` module carries a colocated test (#3062)
 *
 * A structural guard, not a coverage percentage. The slice's whole value is a
 * screen an operator drives a fulfilment router from, and the failures that
 * matter here are silent ones — a name that saves and never fires, a rule
 * refused with no reason, an order reported as unroutable because a picker
 * dropped a stale entry. Coverage numbers do not catch any of those; a missing
 * test file is the one signal that nobody looked.
 *
 * ## It asserts EXISTENCE, deliberately, and nothing about content
 *
 * A test file that asserts nothing would pass this guard, which is why it is
 * framed as the floor rather than the guarantee. What it does buy is that a
 * component or hook added later cannot ship with no test at all and no signal —
 * the failure mode this slice already met once, when a control was shipped,
 * exported and never called by anything (#2380's `markReturnCustodyNotReturned`
 * shape).
 *
 * A module with no behaviour of its own may be listed in `WITHOUT_OWN_TEST`
 * with its reason. The list is deliberately hard to add to: an entry is a
 * statement that the module's behaviour is asserted somewhere else, and must
 * name where.
 *
 * @module apps/web/src/features/oms/__tests__
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURE_ROOT = join(__dirname, '..');
const WALKED = ['api', 'components', 'hooks', 'lib'] as const;

/**
 * Modules whose behaviour is asserted through a consumer rather than directly.
 * Each entry names where — an unexplained entry is a hole with a comment.
 */
const WITHOUT_OWN_TEST: Readonly<Record<string, string>> = {
  // Pure re-declaration of the wire shapes. It has no behaviour; the schema
  // that parses into it is tested in `sourcing-rules.schema.test.ts`.
  'api/sourcing-rules.types.ts': 'shape-only; parsing is covered by sourcing-rules.schema.test.ts',
  // Key factory. Its one property — that a write reaches every sibling query —
  // is asserted through the mutations, where it can actually be observed.
  'api/sourcing-rules.query-keys.ts': 'asserted through use-sourcing-rule-mutations.test.tsx',
  'components/sourcing-rule-locked-dialog.tsx':
    'rendered and asserted through sourcing-rules-section.test.tsx',
  // The two read hooks are exercised through the section and the page, which is
  // where their `enabled` gating is observable.
  'hooks/use-sourcing-rule-query.ts': 'covered by use-sourcing-rules-query.test.tsx',
  'hooks/use-create-sourcing-rule-mutation.ts': 'covered by use-sourcing-rule-mutations.test.tsx',
  'hooks/use-update-sourcing-rule-mutation.ts': 'covered by use-sourcing-rule-mutations.test.tsx',
  'hooks/use-delete-sourcing-rule-mutation.ts': 'covered by use-sourcing-rule-mutations.test.tsx',
  'hooks/use-reorder-sourcing-rules-mutation.ts': 'covered by use-sourcing-rule-mutations.test.tsx',
  'hooks/use-inventory-locations-for-rules-query.ts':
    'covered by sourcing-rules-page.test.tsx, where its two gates are observable',
};

function sourceModules(): string[] {
  const found: string[] = [];
  for (const dir of WALKED) {
    let entries: string[];
    try {
      entries = readdirSync(join(FEATURE_ROOT, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      found.push(`${dir}/${entry}`);
    }
  }
  return found.sort();
}

function testFiles(): Set<string> {
  const found = new Set<string>();
  for (const dir of WALKED) {
    let entries: string[];
    try {
      entries = readdirSync(join(FEATURE_ROOT, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/\.test\.tsx?$/.test(entry)) found.add(`${dir}/${entry}`);
    }
  }
  return found;
}

describe('features/oms test coverage (#3062)', () => {
  it('walks a non-empty set of modules', () => {
    // A guard that matched nothing would report green forever.
    expect(sourceModules().length).toBeGreaterThan(10);
  });

  it('every module has a colocated test, or a named reason not to', () => {
    const tests = testFiles();

    const uncovered = sourceModules().filter((module) => {
      if (module in WITHOUT_OWN_TEST) return false;
      const expected = module.replace(/\.tsx?$/, '');
      return !tests.has(`${expected}.test.ts`) && !tests.has(`${expected}.test.tsx`);
    });

    expect(uncovered).toEqual([]);
  });

  it('carries no stale exemption', () => {
    // Two ways an exemption goes stale, and both are a standing licence for the
    // next file to ship untested: it names a module that no longer exists, or
    // it names one that HAS since grown a colocated test. The second is the one
    // that rots quietly — the entry keeps passing while asserting something
    // that stopped being true.
    const modules = new Set(sourceModules());
    const tests = testFiles();

    const stale = Object.keys(WITHOUT_OWN_TEST).filter((entry) => {
      if (!modules.has(entry)) return true;
      const expected = entry.replace(/\.tsx?$/, '');
      return tests.has(`${expected}.test.ts`) || tests.has(`${expected}.test.tsx`);
    });

    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    const unexplained = Object.entries(WITHOUT_OWN_TEST)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([entry]) => entry);

    expect(unexplained).toEqual([]);
  });
});
