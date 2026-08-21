/**
 * Redis Stream Retention Policy — Unit Tests
 *
 * The load-bearing assertions here are the ones that pin *why* each bound has
 * the shape it does (#2163): that an unregistered stream is still bounded, that
 * `jobs.sync` outlives its dedup TTL, and that no approximate cap sits below a
 * macro node.
 *
 * @module libs/shared/src/redis/__tests__
 */
import {
  DEFAULT_STREAM_BOUND,
  JOB_DEDUP_TTL_MS,
  REDIS_STREAM_NAMES,
  resolveStreamBound,
  STREAM_NODE_MAX_ENTRIES,
  streamTrimOptions,
  xAddBounded,
  type StreamWriteClient,
} from '../stream-retention';

const ALL_STREAMS = Object.values(REDIS_STREAM_NAMES);

describe('resolveStreamBound', () => {
  it.each(ALL_STREAMS)('should resolve a bound for %s', (stream) => {
    expect(resolveStreamBound(stream)).toBeDefined();
  });

  it('should bound a stream that is not registered at all', () => {
    // The central inversion: before #2163 an unlisted stream was left unbounded,
    // so "unbounded" was the default. It is now unreachable.
    expect(resolveStreamBound('some.brand.new.stream')).toEqual(DEFAULT_STREAM_BOUND);
  });

  it('should give jobs.sync an age bound rather than a count bound', () => {
    // A count bound discards silently under exactly the backlog it was sized
    // for, and a trimmed-but-unconsumed entry is a permanently lost job.
    expect(resolveStreamBound(REDIS_STREAM_NAMES.jobsSync).kind).toBe('minid');
  });

  it('should keep the jobs.sync horizon longer than the job dedup TTL', () => {
    // Anything trimmed has certainly lost its `jobdedup:` key, so a re-enqueue
    // no longer no-ops with `{isExisting: true}`. That makes a trimmed job
    // un-blocked, NOT recovered — nothing re-enqueues it automatically.
    const bound = resolveStreamBound(REDIS_STREAM_NAMES.jobsSync);

    expect(bound.kind).toBe('minid');
    if (bound.kind === 'minid') {
      expect(bound.maxAgeMs).toBeGreaterThan(JOB_DEDUP_TTL_MS);
    }
  });

  it('should give the master-deletion DLQ an age bound, unlike the webhook DLQ', () => {
    // The master-deletion DLQ has no Postgres counterpart — it is the sole
    // record that a deletion event was discarded — so FIFO-drop would discard
    // exactly the first entries that identify an incident's trigger.
    expect(resolveStreamBound(REDIS_STREAM_NAMES.masterDeletionDead).kind).toBe('minid');
    expect(resolveStreamBound(REDIS_STREAM_NAMES.inboundWebhooksDead).kind).toBe('maxlen');
  });

  it('should mark the healthcheck cap exact, since it sits below one macro node', () => {
    const bound = resolveStreamBound(REDIS_STREAM_NAMES.healthcheck);

    expect(bound).toEqual({ kind: 'maxlen', threshold: 1, exact: true });
  });

  it.each(ALL_STREAMS)('should keep any approximate cap on %s above one macro node', (stream) => {
    // `~` trims whole macro nodes, so it cannot go below `stream-node-max-entries`.
    // An approximate cap under that silently retains ~100x its stated value.
    const bound = resolveStreamBound(stream);

    if (bound.kind === 'maxlen' && !bound.exact) {
      expect(bound.threshold).toBeGreaterThan(STREAM_NODE_MAX_ENTRIES);
    }
  });

  it.each(ALL_STREAMS)('should keep the bound for %s positive', (stream) => {
    const bound = resolveStreamBound(stream);
    const value = bound.kind === 'maxlen' ? bound.threshold : bound.maxAgeMs;

    expect(value).toBeGreaterThan(0);
  });
});

describe('streamTrimOptions', () => {
  it.each(ALL_STREAMS)('should always return trim options for %s', (stream) => {
    expect(streamTrimOptions(stream).TRIM).toBeDefined();
  });

  it('should return trim options for an unregistered stream', () => {
    // The acceptance criterion: every stream is trimmed, not only a mapped one.
    expect(streamTrimOptions('some.brand.new.stream')).toEqual({
      TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 },
    });
  });

  it('should use approximate trimming for a normal count bound', () => {
    expect(streamTrimOptions(REDIS_STREAM_NAMES.inboundWebhooks)).toEqual({
      TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 50_000 },
    });
  });

  it('should use exact trimming for the healthcheck stream', () => {
    expect(streamTrimOptions(REDIS_STREAM_NAMES.healthcheck)).toEqual({
      TRIM: { strategy: 'MAXLEN', strategyModifier: '=', threshold: 1 },
    });
  });

  it('should derive a MINID threshold from the injected now', () => {
    const now = 1_800_000_000_000;

    const options = streamTrimOptions(REDIS_STREAM_NAMES.jobsSync, now);

    expect(options.TRIM.strategy).toBe('MINID');
    expect(options.TRIM.threshold).toBe(now - 14 * 24 * 60 * 60 * 1000);
  });

  it('should never produce a negative MINID threshold', () => {
    // A stream id is `{ms}-{seq}`; a negative threshold is not a valid id.
    expect(streamTrimOptions(REDIS_STREAM_NAMES.jobsSync, 0).TRIM.threshold).toBe(0);
  });
});

describe('xAddBounded', () => {
  const buildClient = (): jest.Mocked<StreamWriteClient> =>
    ({ xAdd: jest.fn().mockResolvedValue('1-0') }) as unknown as jest.Mocked<StreamWriteClient>;

  it('should pass trim options on every write', async () => {
    const client = buildClient();

    await xAddBounded(client, REDIS_STREAM_NAMES.jobsSync, { jobType: 'a' }, 1_800_000_000_000);

    expect(client.xAdd).toHaveBeenCalledWith(
      REDIS_STREAM_NAMES.jobsSync,
      '*',
      { jobType: 'a' },
      streamTrimOptions(REDIS_STREAM_NAMES.jobsSync, 1_800_000_000_000)
    );
  });

  it.each(ALL_STREAMS)('should pass a defined TRIM option when writing to %s', async (stream) => {
    const client = buildClient();

    await xAddBounded(client, stream, { a: 'b' });

    const options = client.xAdd.mock.calls[0][3];
    expect(options?.TRIM).toBeDefined();
  });

  it('should return the message id from the client', async () => {
    const client = buildClient();

    expect(await xAddBounded(client, REDIS_STREAM_NAMES.healthcheck, { a: 'b' })).toBe('1-0');
  });
});
