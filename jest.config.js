module.exports = {
  projects: [
    '<rootDir>/apps/api',
    '<rootDir>/libs/core',
    '<rootDir>/libs/shared',
  ],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    '**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/*.spec.ts',
    '!**/*.test.ts',
  ],
};




