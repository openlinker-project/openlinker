// Transforms the ESM-only htmlparser2 dependency chain (pulled in transitively
// by sanitize-html >=2.17.6) into CJS so Jest 29 can load it. See
// docs/lessons.md § "An exact dependency pin whose reason lives only in a
// source comment will be lifted by the next upgrade PR" and
// libs/shared/src/html/sanitize-stored-html.ts for the full story. Repo-wide
// tooling — consumed by every jest config that can reach
// @openlinker/shared/html, not just libs/shared's own — so it lives at the
// repo root beside jest.esm-deps.cjs (the source of truth for the list of
// packages this transform applies to) rather than under libs/shared.
// Application source stays on ts-jest (see each package's jest.config.*) —
// this only covers node_modules.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
