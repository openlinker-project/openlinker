// Minimal deterministic Jest test sequencer.
// Avoids pnpm workspace resolution issues with '@jest/test-sequencer'.

class OpenLinkerSequencer {
  /**
   * @param {Array<{path: string}>} tests
   */
  sort(tests) {
    return Array.from(tests).sort((a, b) => a.path.localeCompare(b.path));
  }

  cacheResults() {
    // no-op
  }
}

module.exports = OpenLinkerSequencer;

