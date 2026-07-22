/**
 * In-tree plugin mock-API-namespace registry
 *
 * Single edit point for the test harness's per-plugin mock defaults.
 * Mirrors the role of `apps/web/src/plugins/index.ts` for the test side —
 * adding a new in-tree plugin's mock contributions is one import + one
 * array entry here.
 *
 * Lives under `test/` (not `plugins/`) to make the test-only nature explicit
 * and to keep prod import graphs free of `vitest`'s `vi`. Each plugin owns
 * its mock factory in `plugins/<name>/<name>.mocks.ts` (#603) — that file
 * naming establishes the **convention for plugin test-only side files**.
 * Use `*.mocks.ts` (plural, since each file can ship multiple factories) for
 * any future plugin-local test fixture that imports vitest helpers.
 *
 * Third-party plugin authors that ship test defaults follow the same shape:
 * create `<plugin>.mocks.ts` next to the plugin's `index.ts`, export a
 * `(): Partial<PluginApiNamespaces>` factory, and add it to this array.
 *
 * @module test
 */
import type { PluginApiNamespaces } from '../app/api/api-client';
import { allegroMockApiNamespaces } from '../plugins/allegro/allegro.mocks';
import { ksefMockApiNamespaces } from '../plugins/ksef/ksef.mocks';

export type PluginMockApiNamespacesFactory = () => Partial<PluginApiNamespaces>;

export const IN_TREE_MOCK_API_NAMESPACES: readonly PluginMockApiNamespacesFactory[] = [
  allegroMockApiNamespaces,
  ksefMockApiNamespaces,
];
