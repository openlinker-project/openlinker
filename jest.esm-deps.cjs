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

const BABEL_CONFIG_FILE = path.resolve(__dirname, 'libs/shared/babel.config.cjs');

const ESM_DEPS_TRANSFORM_IGNORE_PATTERN =
  'node_modules/(?!(?:\\.pnpm/)?(?:htmlparser2|domutils|dom-serializer|domhandler|domelementtype|entities)(?:@[^/]+)?/)';

const esmDepsJsTransform = ['babel-jest', { configFile: BABEL_CONFIG_FILE }];

module.exports = {
  ESM_DEPS_TRANSFORM_IGNORE_PATTERN,
  esmDepsJsTransform,
};
