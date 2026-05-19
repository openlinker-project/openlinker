/**
 * Bulk wizard Step 2 — EAN-to-category auto-match
 *
 * Runs `useResolveCategoryQuery` per row in throttled-parallel (cap = 8, see
 * `bulk-throttle.ts`). Shows a progress strip "Resolving N of M…". Auto-
 * advances when every query settles. A 15-second timeout transitions to the
 * Review step regardless; rows whose query hasn't settled are flagged
 * `pending-after-timeout` and continue settling in the background.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../../api/listings.query-keys';
import { BULK_RESOLVE_CONCURRENCY, pAllLimit } from '../../lib/bulk-throttle';
import {
  RESOLVE_CATEGORY_STALE_TIME_MS,
} from '../../hooks/use-resolve-category-query';
import type {
  ResolveCategoryRequest,
  ResolveCategoryResponse,
} from '../../api/listings.types';
import type { BulkWizardRow, BulkRowStatus } from './bulk-wizard.types';

export const BULK_RESOLVE_TIMEOUT_MS = 15_000;

export interface BulkResolveOutcome {
  productId: string;
  status: BulkRowStatus;
  categoryId: string | null;
  method: ResolveCategoryResponse['method'] | null;
}

interface BulkResolveStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  /** Called once with the resolved outcomes for every row. */
  onComplete: (outcomes: BulkResolveOutcome[]) => void;
}

interface ResolveTask {
  productId: string;
  barcode: string | null;
}

export function BulkResolveStep({
  rows,
  connectionId,
  onComplete,
}: BulkResolveStepProps): ReactElement {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [resolved, setResolved] = useState<Map<string, BulkResolveOutcome>>(
    () => seedFromRows(rows),
  );
  const [progress, setProgress] = useState({ done: 0, total: rows.length });
  const startedRef = useRef(false);

  // Tasks that need a BE call (have a barcode, no synthetic outcome yet).
  const tasks: ResolveTask[] = useMemo(
    () =>
      rows
        .filter((r) => {
          if (r.status === 'no-variant') return false;
          const barcode = r.primaryVariant?.ean ?? r.primaryVariant?.gtin ?? null;
          return Boolean(barcode);
        })
        .map((r) => ({
          productId: r.productId,
          barcode: r.primaryVariant!.ean ?? r.primaryVariant!.gtin ?? null,
        })),
    [rows],
  );

  // Kick off the resolves once on mount. The async path is intentionally not
  // a useQuery — we want explicit throttling and a single onComplete fire.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const total = tasks.length;
    let done = 0;

    void (async () => {
      const settled = await pAllLimit(tasks, BULK_RESOLVE_CONCURRENCY, async (task) => {
        // Cache through TanStack so a re-run during edit-back-then-forward
        // gets a hit instead of re-firing Allegro requests.
        const queryKey = listingsQueryKeys.resolveCategory(
          connectionId,
          task.barcode,
        );
        const body: ResolveCategoryRequest = { barcode: task.barcode };
        const result = await queryClient.fetchQuery<ResolveCategoryResponse>({
          queryKey,
          queryFn: () => apiClient.listings.resolveCategory(connectionId, body),
          staleTime: RESOLVE_CATEGORY_STALE_TIME_MS,
        });
        return { productId: task.productId, result };
      });

      if (cancelled) return;

      const next = new Map(resolved);
      settled.forEach((entry, i) => {
        // `pAllLimit` preserves input order, so tasks[i] is the task whose
        // mapper produced this entry — that's the productId we record the
        // result against (success or failure).
        const task = tasks[i];
        if (!task) return;
        if (entry.status === 'fulfilled') {
          const { result } = entry.value;
          next.set(task.productId, {
            productId: task.productId,
            categoryId: result.allegroCategoryId,
            method: result.method,
            status:
              result.allegroCategoryId !== null && result.method !== 'manual'
                ? 'matched'
                : 'no-match',
          });
        } else {
          // Failed lookup → flag as no-match so the operator can fix
          // manually via the edit modal. Without this branch the row stayed
          // in `resolving` forever and "Approve all" stayed blocked with no
          // affordance for the operator to escape it.
          next.set(task.productId, {
            productId: task.productId,
            categoryId: null,
            method: null,
            status: 'no-match',
          });
        }
        done += 1;
        setProgress({ done, total });
      });
      setResolved(next);
      onComplete(buildOutcomes(rows, next));
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally only depends on `tasks` — re-mounts of this step
    // re-resolve from scratch. `rows` and `resolved` deliberately omitted
    // so they don't restart the loop on every status flip.
  }, [tasks]);

  // 15-second budget: if not all tasks settled by now, advance anyway.
  // The Review step still subscribes to the same cached queries via the
  // wizard's outcomes, so late-arriving resolves flip rows from
  // `pending-after-timeout` to `matched` automatically.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onComplete(buildOutcomes(rows, resolved, true));
    }, BULK_RESOLVE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
    // Mount-only effect — the 15 s budget is anchored to mount, not to
    // every render. Resolving fresh state happens through the resolves
    // loop above; this one only fires once.
  }, []);

  // Prefetch the resolved-categories queries so they're hot for the Review
  // step's optional refresh.
  useQueries({
    queries: tasks.map((t) => ({
      queryKey: listingsQueryKeys.resolveCategory(connectionId, t.barcode),
      queryFn: () =>
        apiClient.listings.resolveCategory(connectionId, { barcode: t.barcode }),
      enabled: false, // we drive the resolves manually above; this is a co-cache.
    })),
  });

  const percent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100;

  return (
    <div
      className="bulk-wizard__body--center"
      role="status"
      aria-live="polite"
    >
      <div className="loading-state__spinner" aria-hidden="true" />
      <h2
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          letterSpacing: 'var(--tracking-caps)',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          margin: 0,
        }}
      >
        Resolving categories from EANs
      </h2>
      <div className="bulk-wizard__progress-count">
        {progress.done} of {progress.total}
      </div>
      <div className="bulk-wizard__progress-bar">
        <div
          className="bulk-wizard__progress-fill"
          style={{ width: `${percent.toString()}%` }}
        />
      </div>
      <p className="bulk-wizard__resolve-sub">
        We're matching each product's EAN against Allegro's catalog. This typically
        takes 5–15 seconds. Rows without a clean match are flagged so you can pick a
        category manually before submit.
      </p>
    </div>
  );
}

function seedFromRows(rows: BulkWizardRow[]): Map<string, BulkResolveOutcome> {
  const map = new Map<string, BulkResolveOutcome>();
  for (const row of rows) {
    if (row.status === 'no-variant') {
      map.set(row.productId, {
        productId: row.productId,
        categoryId: null,
        method: null,
        status: 'no-variant',
      });
    } else {
      const barcode = row.primaryVariant?.ean ?? row.primaryVariant?.gtin ?? null;
      if (!barcode) {
        map.set(row.productId, {
          productId: row.productId,
          categoryId: null,
          method: null,
          status: 'no-ean',
        });
      }
    }
  }
  return map;
}

function buildOutcomes(
  rows: BulkWizardRow[],
  resolved: Map<string, BulkResolveOutcome>,
  timedOut = false,
): BulkResolveOutcome[] {
  return rows.map((row) => {
    const fromResolved = resolved.get(row.productId);
    if (fromResolved) return fromResolved;
    return {
      productId: row.productId,
      categoryId: null,
      method: null,
      status: timedOut ? 'pending-after-timeout' : 'resolving',
    };
  });
}
