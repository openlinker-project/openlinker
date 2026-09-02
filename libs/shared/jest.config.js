module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testSequencer: '<rootDir>/../test/openlinker.sequencer.cjs',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['babel-jest', { configFile: require.resolve('./babel.config.cjs') }],
  },
  // htmlparser2 (pulled in by sanitize-html >=2.17.6) and its own dependency
  // chain (domutils, domhandler, domelementtype, entities) ship ESM-only —
  // see docs/lessons.md and src/html/sanitize-stored-html.ts.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?(?:htmlparser2|domutils|dom-serializer|domhandler|domelementtype|entities)(?:@[^/]+)?/)',
  ],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@openlinker/shared/(.*)$': '<rootDir>/$1',
    '^@openlinker/core/(.*)$': '<rootDir>/../../libs/core/src/$1',
  },
  passWithNoTests: true,
};
