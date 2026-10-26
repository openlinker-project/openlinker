/**
 * Transpile-only ts-jest transform - one builder, three readers.
 *
 * ts-jest's default builds a TypeScript program and type-checks it, and Jest
 * resets the module registry per FILE, so that work is repeated once per test
 * file. Measured cold on this repo, same spec, only this option changed:
 *
 *   libs/core   84.5 s -> 8.2 s
 *   apps/api    64.5 s -> 10.4 s
 *
 * The same lever #3263 pulled on the integration tier, where an EMPTY spec
 * measured 11.9 s against 0.5 s.
 *
 * WHAT IT COSTS, STATED PLAINLY. `isolatedModules` switches ts-jest to
 * `ts.transpileModule`, which has no program and therefore cannot type-check.
 * Verified rather than assumed: a `const x: number = 'text'` planted in a spec
 * still PASSES under this transform, and `tsc --noEmit` reports it as TS2322.
 * So type errors in test files are caught by the `Type Check` job and not by
 * the test run. That job runs in parallel, so it costs nothing on the clock -
 * but it is only true for a package whose tsconfig INCLUDES its specs.
 *
 * `libs/shared` and `libs/test-kit` exclude their spec files from their tsconfig,
 * so for those two this transform would remove the only checking their specs
 * have. They are deliberately NOT converted; converting them needs a
 * `tsconfig.test-check.json` plus a step in the Type Check job, the way #3263
 * paid for the integration tier. Check that a package's specs are inside its
 * type-check scope BEFORE adding it here.
 *
 * WHY `moduleResolution: 'node'` IS NOT OPTIONAL. ts-jest forces
 * `module: CommonJS` for a non-ESM package, while `tsconfig.base.json` sets
 * `moduleResolution: Node16`. TypeScript rejects that pair with TS5110 and the
 * suite fails to run at all. #3263 silenced it with `diagnostics: false`; this
 * fixes the mismatch instead, which is better in a small way - a syntactic
 * error still surfaces at test time rather than being hidden.
 *
 * It also removes mtime from the transform cache key. ts-jest's `getCacheKey`
 * folds `statSync(moduleName).mtimeMs` for every RESOLVED IMPORT of a file,
 * and does so only on the `!configs.isolatedModules` branch - so under this
 * transform the key is content and config alone. That is the root cause the
 * `scripts/normalize-source-mtimes.mjs` step works around; the step is kept for
 * now because it also helps the packages not converted here.
 *
 * CJS, and at the repo root, mirroring `jest.esm-deps.cjs`,
 * `jest.test-workers.cjs` and `jest.unit-workers.cjs`.
 *
 * @module jest
 */

/**
 * Build the `transform` entry for a TypeScript-to-CommonJS jest package.
 *
 * `overrides.tsconfig` must be an OBJECT of compiler options, never a path.
 * ts-jest merges an object over the tsconfig it discovers by walking up from
 * `rootDir`, which is the same file a `<rootDir>/../tsconfig.json` path would
 * have named - so a package that used the path form loses nothing by dropping
 * it, and gains the ability to have `moduleResolution` merged in.
 *
 * NOT for an ESM package. `libs/integrations/*` set `useESM: true` with their
 * own `tsconfig.spec.json`, where forcing `moduleResolution: 'node'` is the
 * wrong answer and the emit shape differs. Those are a separate decision.
 */
function transpileOnlyTsJest(overrides = {}) {
  const { tsconfig, ...rest } = overrides;
  return [
    'ts-jest',
    {
      isolatedModules: true,
      ...rest,
      tsconfig: { moduleResolution: 'node', ...(tsconfig ?? {}) },
    },
  ];
}

module.exports = { transpileOnlyTsJest };
