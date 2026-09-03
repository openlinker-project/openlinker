'use strict';

// Shared fragment for the ESM-only htmlparser2 dependency chain pulled in
// transitively by sanitize-html >=2.17.6 (domutils, dom-serializer,
// domhandler, domelementtype, entities). Any jest config whose module graph
// can reach @openlinker/shared/html must merge this in — via babel-jest for
// .js files plus a transformIgnorePatterns override — or Jest throws
// "SyntaxError: Cannot use import statement outside a module" trying to load
// htmlparser2's ESM build. Application .ts source keeps using ts-jest; this
// only covers node_modules. See docs/lessons.md and
// libs/shared/src/html/sanitize-stored-html.ts for the full story.
const path = require('path');

const BABEL_CONFIG_FILE = path.resolve(__dirname, 'babel.esm-deps.cjs');

// This pattern REPLACES Jest's default `transformIgnorePatterns`
// (`["/node_modules/"]`), it does not extend it — a jest config's
// `transformIgnorePatterns: [ESM_DEPS_TRANSFORM_IGNORE_PATTERN]` array has
// exactly one element, and that element is written to subsume the default
// (it still excludes the rest of `node_modules` from transformation; it just
// additionally carves out the six ESM-only packages below). A future reader
// adding a second pattern to that array should not assume additive
// semantics — Jest ANDs multiple `transformIgnorePatterns` entries together
// (a file must match ALL of them to be left untransformed), so adding an
// unrelated pattern here can silently widen what gets transformed.
const ESM_DEPS_TRANSFORM_IGNORE_PATTERN =
  'node_modules/(?!(?:\\.pnpm/)?(?:htmlparser2|domutils|dom-serializer|domhandler|domelementtype|entities)(?:@[^/]+)?/)';

const esmDepsJsTransform = ['babel-jest', { configFile: BABEL_CONFIG_FILE }];

module.exports = {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
};
