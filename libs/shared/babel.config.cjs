// Transforms the ESM-only htmlparser2 dependency chain (pulled in transitively
// by sanitize-html >=2.17.6) into CJS so Jest 29 can load it. See
// docs/lessons.md § "An exact dependency pin whose reason lives only in a
// source comment will be lifted by the next upgrade PR" and
// src/html/sanitize-stored-html.ts for the full story. Application source
// stays on ts-jest (see jest.config.js) — this only covers node_modules.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
