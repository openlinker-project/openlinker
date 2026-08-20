// Minimal deterministic Jest test sequencer.
// Avoids pnpm workspace resolution issues with '@jest/test-sequencer'.

class OpenLinkerSequencer {
  /**
   * @param {Array<{path: string}>} tests
   */
  sort(tests) {
    return Array.from(tests).sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Jest calls this after a run to allow the sequencer to persist results.
   * We don't need this, but we must implement it to satisfy Jest's expectations.
   */
  cacheResults() {
    // no-op
  }
}

module.exports = OpenLinkerSequencer;

