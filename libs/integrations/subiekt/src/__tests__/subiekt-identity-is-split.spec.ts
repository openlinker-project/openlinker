/**
 * Guard: Subiekt GT and Subiekt nexo never share an identity (backend half).
 *
 * Subiekt GT and Subiekt nexo are two separate InsERT products reached through
 * two different bridges with different wire contracts. Only GT has an adapter
 * here; if a nexo one is ever built it gets its own `platformType` and its own
 * `adapterKey`, and no alias maps the retired bare `'subiekt'` onto either -
 * such an alias would be ambiguous the moment the second product exists.
 *
 * Separate from `subiekt-plugin.spec.ts`, which asserts what the manifest IS.
 * This asserts what it must NEVER be, plus the cross-file agreements that have
 * no compiler to enforce them:
 *
 *   - the scheduler tasks' `platformType` must equal the manifest's, or the
 *     scheduler matches zero connections, logs at DEBUG and returns - so the
 *     poll silently stops running with no error anywhere;
 *   - the persisted keys that merely CONTAIN "subiekt" must keep it, or a
 *     rename orphans live data (the cursor restarts the order feed from the
 *     beginning of time; the jobType stops being recognised).
 *
 * @module libs/integrations/subiekt/src/__tests__
 */
import { subiektAdapterManifest } from '../subiekt-plugin';
import { buildSubiektSchedulerTasks } from '../infrastructure/scheduler/subiekt-scheduler-tasks';
import { SUBIEKT_PROVIDER_TYPE } from '../infrastructure/adapters/subiekt-invoicing.adapter';
import { SUBIEKT_FISCAL_PROVIDER_TYPE } from '../infrastructure/adapters/subiekt-fiscalization.adapter';

/** Values that must never come back. */
const RETIRED_IDENTITIES = ['subiekt', 'subiekt.invoicing.v1'];

describe('Subiekt identity is split (GT vs nexo)', () => {
  describe('the manifest names Subiekt GT specifically', () => {
    it('uses the GT platformType and adapterKey', () => {
      expect(subiektAdapterManifest.platformType).toBe('subiekt-gt');
      expect(subiektAdapterManifest.adapterKey).toBe('subiekt.gt.v1');
    });

    it('never carries a retired identity', () => {
      expect(RETIRED_IDENTITIES).not.toContain(subiektAdapterManifest.platformType);
      expect(RETIRED_IDENTITIES).not.toContain(subiektAdapterManifest.adapterKey);
    });

    it('says GT in the operator-facing display name, and does not say nexo', () => {
      expect(subiektAdapterManifest.displayName).toContain('GT');
      expect(subiektAdapterManifest.displayName?.toLowerCase()).not.toContain('nexo');
    });
  });

  describe('provider identifiers stamped onto documents', () => {
    it('stamps the GT provider type on invoices and fiscal registrations', () => {
      expect(SUBIEKT_PROVIDER_TYPE).toBe('subiekt-gt');
      expect(SUBIEKT_FISCAL_PROVIDER_TYPE).toBe('subiekt-gt');
    });

    it('never stamps a retired identity', () => {
      expect(RETIRED_IDENTITIES).not.toContain(SUBIEKT_PROVIDER_TYPE);
      expect(RETIRED_IDENTITIES).not.toContain(SUBIEKT_FISCAL_PROVIDER_TYPE);
    });
  });

  describe('scheduler tasks agree with the manifest', () => {
    it('targets the manifest platformType on every task', () => {
      const tasks = buildSubiektSchedulerTasks();

      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks) {
        expect(task.platformType).toBe(subiektAdapterManifest.platformType);
      }
    });
  });

  describe('persisted keys keep the bare `subiekt` prefix', () => {
    // These are stored values, not identity. Renaming them orphans live data,
    // which is why the identity split deliberately stopped short of them.
    it('keeps the reachability-sweep jobType', () => {
      const sweep = buildSubiektSchedulerTasks().find(
        (task) => task.taskId === 'subiekt-bridge-reachability-sweep'
      );

      expect(sweep?.jobType).toBe('subiekt.bridge.reachabilitySweep');
    });

    it('keeps the order-feed cursor key', () => {
      const poll = buildSubiektSchedulerTasks().find(
        (task) => task.taskId === 'subiekt-orders-poll'
      );
      // `generatePayload` takes the connection; this task ignores it, so a
      // minimal stand-in is enough and keeps the test off a full fixture.
      const payload = poll?.generatePayload({ id: 'irrelevant' } as never) as
        | { cursorKey?: string }
        | undefined;

      // Renaming this restarts the feed from the beginning and re-ingests the
      // entire order history.
      expect(payload?.cursorKey).toBe('subiekt.orders.dataWystawieniaCursor');
    });
  });
});
