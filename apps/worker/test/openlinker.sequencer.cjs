/**
 * Minimal Jest sequencer to avoid relying on resolving `@jest/test-sequencer`
 * under pnpm's isolated node_modules layout.
 *
 * This sequencer provides deterministic test ordering without requiring
 * Jest's default sequencer module resolution, which can fail in pnpm workspaces.
 */
class OpenLinkerTestSequencer {
  sort(tests) {
    // Deterministic order: alphabetical by path
    return Array.from(tests).sort((a, b) => a.path.localeCompare(b.path));
  }

  allFailedTests(tests) {
    // Keep deterministic; don't rely on Jest timing cache
    return this.sort(tests);
  }

  cacheResults(_tests, _results) {
    // no-op (we're not using timing-based ordering)
  }

  shard(tests, { shardIndex, shardCount }) {
    const sorted = this.sort(tests);
    const per = Math.ceil(sorted.length / shardCount);
    const start = per * (shardIndex - 1);
    return sorted.slice(start, start + per);
  }
}

module.exports = OpenLinkerTestSequencer;

