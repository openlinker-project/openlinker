/**
 * The bench's work list (#2416, `W3b-3`, Surfaces B and C)
 *
 * Composes the whole of Surface B, and is where the scanner primitive is
 * exercised for story C3.
 *
 * ## Every scan on THIS surface is unrecognised, and that is the truth
 *
 * Decision D11: OpenLinker prints no barcode and mints no scannable parcel
 * identity, so nothing on a work list can be scanned. Rather than leave the
 * primitive unexercised, the list consumes it to say exactly that — immediately,
 * distinctly, and recording nothing, which is C3 verbatim. It also teaches the
 * packer, at the moment they try it, that a parcel is found by typing.
 *
 * ## No links out of the flow (C2)
 *
 * There is no anchor and no router link anywhere in this subtree. Leaving the
 * bench is the identity bar's deliberate action (#2413), which is the only exit.
 * `bench-work-list.test.tsx` asserts the absence.
 *
 * @module apps/web/src/features/bench/components
 */
import { useMemo, useState, type ReactElement } from 'react';

import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useDemoMode } from '../../system';
import type { BenchWork } from '../api/bench-work.types';
import { useBenchExpediteMutation } from '../hooks/use-bench-expedite-mutation';
import { useBenchInteractive } from '../hooks/use-bench-interactive';
import { useBenchWorkQuery } from '../hooks/use-bench-work-query';
import { useScannerInput } from '../hooks/use-scanner-input';
import { groupBenchWork, matchesBenchSearch } from '../lib/bench-work-presentation';
import { benchWorkCopy } from '../lib/bench-work.copy';
import { BenchWorkEmpty } from './bench-work-empty';
import { BenchWorkRow } from './bench-work-row';

export interface BenchWorkListProps {
  /** Injected in tests so deadline phrasing is deterministic. */
  readonly now?: Date;
  /** #2418's seam. Absent renders no open control — see `BenchWorkRow`. */
  readonly onOpenParcel?: (work: BenchWork) => void;
}

export function BenchWorkList({ now, onOpenParcel }: BenchWorkListProps): ReactElement {
  const query = useBenchWorkQuery();
  const expedite = useBenchExpediteMutation();
  const demoMode = useDemoMode();
  // `orders:write` is what the shipped operator worklist already gates its
  // fulfilment actions on, and its holders are exactly the action route's
  // `@Roles('admin','operator')`. A packer holds no permissions at all, so the
  // control is invisible to one — which is story B5's "someone with write
  // access", not a second permission invented for this surface.
  const write = useWriteAccess('orders:write', demoMode);
  // A3. See `use-bench-interactive.ts` — a covered surface takes the listener
  // off, so a scan at a locked bench raises nothing behind the lock.
  const interactive = useBenchInteractive();

  const [search, setSearch] = useState('');
  const [rejectedScan, setRejectedScan] = useState<string | null>(null);

  useScannerInput({
    enabled: interactive,
    // C3. Nothing here is scannable, so every completed gesture is reported and
    // nothing is recorded — no request is made, and no state but this notice
    // changes.
    onScan: (gesture) => {
      setRejectedScan(gesture.value);
    },
  });

  const works = query.data?.works ?? [];
  const visible = useMemo(
    () => works.filter((work) => matchesBenchSearch(work, search)),
    [works, search]
  );
  const { toPack, doNotPack } = useMemo(() => groupBenchWork(visible), [visible]);

  // Only on the FIRST load, never on a background refetch.
  //
  // The surface polls every 30 seconds. Keying this on `isLoading` — which is
  // true whenever the query is pending AND fetching — blanks the whole screen
  // on each poll: the rows vanish, and so does the search field, mid-word, so a
  // packer typing a reference loses what they typed twice a minute. Keying on
  // "we have never had data" keeps the list on screen while the next read is in
  // flight, which is both what a bench needs and what the copy promises when it
  // says the list updates by itself.
  if (query.data === undefined && query.isPending) {
    return (
      <LoadingState title={benchWorkCopy.loading.title} message={benchWorkCopy.loading.body} />
    );
  }

  if (query.error && query.data === undefined) {
    return (
      <ErrorState
        title={benchWorkCopy.errors.loadTitle}
        message={query.error.message}
        action={
          <Button
            tone="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {benchWorkCopy.errors.retryAction}
          </Button>
        }
      />
    );
  }

  const routingReady = query.data?.routing.ready ?? true;
  const canExpedite = write.canWrite;

  const renderSection = (
    heading: string,
    rows: readonly BenchWork[],
    testId: string
  ): ReactElement | null =>
    rows.length === 0 ? null : (
      <section className="bench-work-list__section" data-testid={testId}>
        <h2 className="bench-work-list__section-heading">
          {heading} · {rows.length}
        </h2>
        <ul className="bench-work-list__rows">
          {rows.map((work) => (
            <BenchWorkRow
              key={work.workId}
              work={work}
              now={now}
              canExpedite={canExpedite}
              expediting={expedite.isPending}
              onExpedite={(target, action) => {
                expedite.mutate({
                  workId: target.workId,
                  action,
                  // From the row AS RENDERED — never re-read from the cache.
                  expectedVersion: target.version,
                });
              }}
              onOpenParcel={onOpenParcel}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="bench-work-list" data-testid="bench-work-list">
      <header className="bench-work-list__header">
        <p className="eyebrow">{benchWorkCopy.header.eyebrow}</p>
        <h1 className="bench-work-list__title">
          {query.data?.executorName ?? benchWorkCopy.header.fallbackTitle}
        </h1>
        <span className="bench-work-list__ordering">{benchWorkCopy.header.orderingNote}</span>
      </header>

      <p className="bench-work-list__scope">{benchWorkCopy.scope.note}</p>

      <div className="bench-work-list__search">
        <label htmlFor="bench-search">{benchWorkCopy.search.label}</label>
        <input
          id="bench-search"
          type="text"
          inputMode="search"
          autoComplete="off"
          placeholder={benchWorkCopy.search.placeholder}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <span className="bench-work-list__search-hint">{benchWorkCopy.search.hint}</span>
      </div>

      {/* C3: immediate, distinct, and it records nothing. `role="alert"` so it
          reaches a screen reader without the packer looking up from the box. */}
      {rejectedScan === null ? null : (
        <Alert
          tone="error"
          title={benchWorkCopy.scan.unrecognisedTitle}
          action={
            <Button
              tone="secondary"
              onClick={() => {
                setRejectedScan(null);
              }}
            >
              {benchWorkCopy.scan.dismissAction}
            </Button>
          }
        >
          {benchWorkCopy.scan.unrecognisedBody}{' '}
          {/* What actually came off the scanner. A packer needs to SEE a
              misread — "not recognised" without the value leaves them guessing
              whether the label is damaged or the wrong box is in front of them. */}
          <span className="bench-work-list__scanned">
            {benchWorkCopy.scan.scannedLabel}: <code>{rejectedScan}</code>
          </span>
        </Alert>
      )}

      {expedite.error ? (
        <Alert tone="warning">{benchWorkCopy.row.expediteFailed}</Alert>
      ) : null}

      {write.demoReadOnly ? <Alert tone="info">{DEMO_READ_ONLY_ACTION_MESSAGE}</Alert> : null}

      {works.length === 0 ? (
        <BenchWorkEmpty routingReady={routingReady} />
      ) : (
        <>
          {renderSection(benchWorkCopy.sections.toPack, toPack, 'bench-section-to-pack')}
          {renderSection(
            benchWorkCopy.sections.doNotPack,
            doNotPack,
            'bench-section-do-not-pack'
          )}
          {/* A search that hides everything is not an empty bench, and must not
              render the empty-bench screen — that would say the work is gone. */}
          {visible.length === 0 ? (
            <p className="bench-work-list__no-matches" data-testid="bench-search-no-matches">
              {benchWorkCopy.search.noMatches}
            </p>
          ) : null}
        </>
      )}

      {/* Said rather than left to be discovered: the read is capped, and a
          truncated list must not look like the whole of the work. */}
      {(query.data?.total ?? 0) > works.length ? (
        <p className="bench-work-list__truncated">{benchWorkCopy.truncated.note}</p>
      ) : null}

      <footer className="bench-work-list__footer">
        <span>{benchWorkCopy.footer.honesty}</span>
        <span>{benchWorkCopy.footer.liveness}</span>
      </footer>
    </div>
  );
}
