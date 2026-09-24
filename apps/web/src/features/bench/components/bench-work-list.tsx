/**
 * The bench's work list (#2416, `W3b-3`, Surfaces B and C; restructured into
 * the rail's three tabs by #3416, mockup-parity epic #3401)
 *
 * Composes the whole of Surface B, and is where the scanner primitive is
 * exercised for story C3.
 *
 * ## Three tabs, and the first one holds four sections
 *
 * The mockup's rail is `At this bench` / `On hold` / `Packed today`, each
 * carrying its own count. The first tab is what B4's `groupBenchWork` used
 * to render on its own — its `toPack` rows are now split a second time, by
 * ADR-074 assignment, into "Assigned to you" / "Assigned to other packers"
 * (present only when non-empty; the mockup's own demo data has none) /
 * "Unassigned", with the bench's finished-but-unlabelled parcels
 * (`useBenchUnlabelledQuery`, #2418's own read — never a second source of
 * that list, or this rail and dispatch could disagree about a box on the
 * floor) appended as a fourth, read-mostly section. `On hold` is B4's
 * `doNotPack` rows, unchanged. `Packed today` is `useBenchPackedTodayQuery`
 * (#3413) — a log, never a queue, so its rows are `BenchPackedTodayRow`,
 * plain `<li>`s with no open control.
 *
 * ## Search is scoped to the OPEN tab (mockup's own rule)
 *
 * "whichever tab is open, so it never silently searches a hidden tab" — the
 * mockup's comment on its own `railSearch` handler. The field stays mounted
 * across a tab switch (state lives in this component, not per-tab), and what
 * changes is which section arrays it is applied to.
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
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useDemoMode } from '../../system';
import type { BenchWork } from '../api/bench-work.types';
import { useBenchClaimMutation, useBenchClaimNextMutation } from '../hooks/use-bench-claim-mutation';
import { useBenchExpediteMutation } from '../hooks/use-bench-expedite-mutation';
import { useBenchInteractive } from '../hooks/use-bench-interactive';
import { useBenchPackedTodayQuery } from '../hooks/use-bench-activity-query';
import { useBenchUnlabelledQuery } from '../hooks/use-bench-documents-query';
import { useBenchWorkQuery } from '../hooks/use-bench-work-query';
import { useScannerInput } from '../hooks/use-scanner-input';
import { isEditableTarget } from '../lib/scanner-gesture';
import {
  groupBenchWork,
  groupBenchWorkByAssignment,
  matchesBenchSearch,
  matchesBenchTextSearch,
} from '../lib/bench-work-presentation';
import { benchWorkCopy } from '../lib/bench-work.copy';
import { BenchPackedTodayRow } from './bench-packed-today-row';
import { BenchUnlabelledRow } from './bench-unlabelled-row';
import { BenchWorkEmpty } from './bench-work-empty';
import { BenchWorkRow } from './bench-work-row';

export interface BenchWorkListProps {
  /** Injected in tests so deadline phrasing is deterministic. */
  readonly now?: Date;
  /** #2418's seam. Absent renders no open control — see `BenchWorkRow`. */
  readonly onOpenParcel?: (workId: string) => void;
  /**
   * The box currently open in the pane beside this rail (#3401). Marks its
   * row `aria-current` so a packer can see at a glance which of the four
   * sections the box in front of them came from. `null` while nothing is
   * open, which is also the whole of this prop's default behaviour.
   */
  readonly activeWorkId?: string | null;
}

type BenchRailTab = 'bench' | 'hold' | 'done';

/**
 * Which sentence a refused claim gets — either "take next task" or a direct
 * "claim this parcel" (#3412/#3415).
 *
 * `not-claimable` and `claimed-by-someone-else` are DIFFERENT facts and must
 * read differently: the first is the standing ADR-074 lock — a supervisor
 * assigned this parcel elsewhere, and retrying changes nothing — while the
 * second is a peer winning the race between the read that offered it and the
 * write, which a retry genuinely can win. Telling a packer "this is not
 * yours" about a parcel that was theirs to take a moment ago sends them to a
 * supervisor for nothing.
 *
 * An unrecognised reason falls back to the race sentence rather than to the
 * lock or the empty-queue one: this build not knowing the word is not
 * evidence of a standing lock or an empty queue, and "try again" is the safe
 * reading of a refusal this build cannot name.
 */
function claimNextRefusalNotice(reason: string | null): string {
  if (reason === 'held') return benchWorkCopy.tabs.takeNextHeld;
  if (reason === 'cancelled') return benchWorkCopy.tabs.takeNextCancelled;
  if (reason === 'not-claimable') return benchWorkCopy.tabs.takeNextLocked;
  return benchWorkCopy.tabs.takeNextTaken;
}

export function BenchWorkList({
  now,
  onOpenParcel,
  activeWorkId = null,
}: BenchWorkListProps): ReactElement {
  const query = useBenchWorkQuery();
  const unlabelledQuery = useBenchUnlabelledQuery();
  const packedTodayQuery = useBenchPackedTodayQuery();
  const expedite = useBenchExpediteMutation();
  const claim = useBenchClaimMutation();
  const claimNext = useBenchClaimNextMutation();
  const demoMode = useDemoMode();
  // `orders:write` is what the shipped operator worklist already gates its
  // fulfilment actions on, and its holders are exactly the action route's
  // `@Roles('admin','operator')`. A packer holds no permissions at all, so the
  // control is invisible to one — which is story B5's "someone with write
  // access", not a second permission invented for this surface.
  // `bench:write`, never `orders:write` (#3424): a packer holds the first and
  // not the second, so gating on the second hid both claim controls from the
  // only role that presses them while the API behind them accepted a packer
  // all along.
  const write = useWriteAccess('bench:write', demoMode);
  // A3. See `use-bench-interactive.ts` — a covered surface takes the listener
  // off, so a scan at a locked bench raises nothing behind the lock.
  const interactive = useBenchInteractive();

  const [search, setSearch] = useState('');
  const [rejectedScan, setRejectedScan] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BenchRailTab>('bench');
  const [claimNextNotice, setClaimNextNotice] = useState<string | null>(null);
  /**
   * Why the last DIRECT claim was refused, or `null`.
   *
   * Separate from `claimNextNotice` because the two sit in different places —
   * that one under the "Take next task" button it belongs to, this one in the
   * alert strip beside `claim.error`, which is the other way this same button
   * can fail. Sharing one slot would put a message about a parcel the packer
   * picked under a button they did not press.
   */
  const [claimRefusal, setClaimRefusal] = useState<string | null>(null);

  /** Lets the `N` hotkey reach the handler defined below. */
  const takeNextRef = useRef<() => void>(() => undefined);

  /**
   * "N" takes the next task — the mockup's own legend, bound HERE rather than
   * on the parcel surface because this is the component that owns the
   * `claimNext` mutation. Both panes are mounted at once (#3401), so the key
   * works while a box is open, which is when a packer reaches for it.
   *
   * Same enabled-gate as the scanner listener below: a locked bench takes no
   * input at all (A3).
   */
  useEffect(() => {
    if (!interactive) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      takeNextRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [interactive]);

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
  const { toPack, doNotPack } = useMemo(() => groupBenchWork(works), [works]);
  const { mine, assignedOther, unassigned } = useMemo(
    () => groupBenchWorkByAssignment(toPack),
    [toPack]
  );
  const unlabelled = unlabelledQuery.data?.parcels ?? [];
  const packedToday = packedTodayQuery.data?.works ?? [];

  const searchFilter = (rows: readonly BenchWork[]): BenchWork[] =>
    rows.filter((work) => matchesBenchSearch(work, search));

  const visibleMine = useMemo(() => searchFilter(mine), [mine, search]);
  const visibleAssignedOther = useMemo(() => searchFilter(assignedOther), [assignedOther, search]);
  const visibleUnassigned = useMemo(() => searchFilter(unassigned), [unassigned, search]);
  const visibleUnlabelled = useMemo(
    () =>
      unlabelled.filter((parcel) =>
        matchesBenchTextSearch(parcel.orderReference, null, search)
      ),
    [unlabelled, search]
  );
  const visibleDoNotPack = useMemo(() => searchFilter(doNotPack), [doNotPack, search]);
  const visiblePackedToday = useMemo(
    () =>
      packedToday.filter((row) =>
        matchesBenchTextSearch(row.orderReference, row.buyerName, search)
      ),
    [packedToday, search]
  );

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

  /** ONE body for the button and the `N` key — two copies could diverge. */
  const takeNextTask = (): void => {
    setClaimNextNotice(null);
    claimNext.mutate(undefined, {
      onSuccess: (result) => {
        if (result.outcome === 'nothing-to-claim') {
          setClaimNextNotice(benchWorkCopy.tabs.takeNextEmpty);
          return;
        }
        if (result.outcome === 'refused') {
          // NOT the empty-queue message. A parcel was found and lost, so the
          // rail is still holding rows and "nothing here" would contradict
          // what the packer is looking at. Every reason says "try again",
          // because in each case there genuinely may be more.
          setClaimNextNotice(claimNextRefusalNotice(result.reason));
        }
      },
    });
  };
  takeNextRef.current = takeNextTask;

  const routingReady = query.data?.routing.ready ?? true;
  const canExpedite = write.canWrite;
  const canClaim = write.canWrite;

  const renderWorkRows = (rows: readonly BenchWork[], testId: string): ReactElement | null =>
    rows.length === 0 ? null : (
      <ul className="bench-rail__list" data-testid={testId}>
        {rows.map((work) => (
          <BenchWorkRow
            key={work.workId}
            work={work}
            now={now}
            active={work.workId === activeWorkId}
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
            onClaim={
              canClaim
                ? (target: BenchWork): void => {
                    setClaimRefusal(null);
                    claim.mutate(target.workId, {
                      onSuccess: (result) => {
                        // A refusal arrives as a 200, so `claim.error` stays
                        // null and nothing rendered at all: the packer clicked
                        // and the screen did not move. Reported here instead,
                        // in the same words the "take next" refusal uses.
                        if (result.outcome === 'refused') {
                          setClaimRefusal(claimNextRefusalNotice(result.reason));
                        }
                      },
                    });
                  }
                : undefined
            }
            claiming={claim.isPending}
          />
        ))}
      </ul>
    );

  const renderSection = (
    heading: string,
    rows: readonly BenchWork[],
    testId: string,
    headingClassName?: string
  ): ReactElement | null =>
    rows.length === 0 ? null : (
      <section className="bench-rail__section" data-testid={testId}>
        {/* The mockup's `.rail__section-label` — mono caps, count pushed to
            the trailing edge. Still an `h2`, so the rail keeps a real
            heading outline for a screen reader. */}
        <h2 className={`bench-rail__section-label ${headingClassName ?? ''}`.trim()}>
          <span>{heading}</span>
          <span className="mono">{rows.length}</span>
        </h2>
        {renderWorkRows(rows, `${testId}-rows`)}
      </section>
    );

  const bothCounts = {
    bench: toPack.length + unlabelled.length,
    hold: doNotPack.length,
    done: packedTodayQuery.data?.total ?? packedToday.length,
  };

  const noBenchSectionMatches =
    search.trim().length > 0 &&
    toPack.length + unlabelled.length > 0 &&
    visibleMine.length === 0 &&
    visibleAssignedOther.length === 0 &&
    visibleUnassigned.length === 0 &&
    visibleUnlabelled.length === 0;

  const noHoldSectionMatches =
    search.trim().length > 0 && doNotPack.length > 0 && visibleDoNotPack.length === 0;

  const noDoneSectionMatches =
    search.trim().length > 0 && packedToday.length > 0 && visiblePackedToday.length === 0;

  return (
    <div className="bench-work-list" data-testid="bench-work-list">
      {/* The mockup's rail opens with the SEARCH FIELD. It carries no page
          title at all — the bench topbar already says where you are, and a
          1.5rem heading in a 340 px column pushed the one control a packer
          reaches for below the fold. The executor's name and the ordering
          rule are standing facts and moved to the footer with the rest. */}
      <div className="bench-rail__search">
        <label htmlFor="bench-search" className="sr-only">
          {benchWorkCopy.search.label}
        </label>
        <input
          id="bench-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder={benchWorkCopy.search.placeholder}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {/* #3412/#3416 — "Take next task": the server picks, oldest deadline
          first among the unassigned. Same underlying move as "Claim this
          parcel", offered once, directly under the search and above the
          tabs, since it is not scoped to any one section. */}
      {canClaim ? (
        <div className="bench-rail__take-next">
          <Button tone="primary" disabled={claimNext.isPending} onClick={takeNextTask}>
            {benchWorkCopy.tabs.takeNextAction}
          </Button>
          {claimNextNotice === null ? null : (
            <p className="bench-work-list__take-next-notice">{claimNextNotice}</p>
          )}
          {claimNext.error ? (
            <Alert tone="warning">{benchWorkCopy.tabs.takeNextFailed}</Alert>
          ) : null}
        </div>
      ) : null}

      {/* #3416 — the rail's three tabs. Real filtering, not decoration: the
          inactive panels are unmounted, matching the mockup's own
          `hidden`-attribute behaviour. */}
      <div className="bench-rail__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'bench'}
          className="bench-rail__tab"
          onClick={() => {
            setActiveTab('bench');
          }}
        >
          {benchWorkCopy.tabs.bench} <span className="mono">{bothCounts.bench}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'hold'}
          className="bench-rail__tab"
          onClick={() => {
            setActiveTab('hold');
          }}
        >
          {benchWorkCopy.tabs.hold} <span className="mono">{bothCounts.hold}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'done'}
          className="bench-rail__tab"
          onClick={() => {
            setActiveTab('done');
          }}
        >
          {benchWorkCopy.tabs.done} <span className="mono">{bothCounts.done}</span>
        </button>
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

      {claim.error ? <Alert tone="warning">{benchWorkCopy.tabs.claimFailed}</Alert> : null}

      {claimRefusal === null ? null : <Alert tone="warning">{claimRefusal}</Alert>}

      {write.demoReadOnly ? <Alert tone="info">{DEMO_READ_ONLY_ACTION_MESSAGE}</Alert> : null}

      {works.length === 0 && unlabelled.length === 0 ? (
        <BenchWorkEmpty routingReady={routingReady} />
      ) : (
        <div data-testid={`bench-tab-panel-${activeTab}`}>
          {activeTab === 'bench' ? (
            <>
              {renderSection(
                benchWorkCopy.tabs.assignedToYou,
                visibleMine,
                'bench-section-assigned-to-you',
                'bench-rail__section-label--mine'
              )}
              {renderSection(
                benchWorkCopy.tabs.assignedToOthers,
                visibleAssignedOther,
                'bench-section-assigned-others'
              )}
              {renderSection(
                benchWorkCopy.tabs.unassigned,
                visibleUnassigned,
                'bench-section-unassigned'
              )}
              {visibleUnlabelled.length === 0 ? null : (
                <section
                  className="bench-rail__section"
                  data-testid="bench-section-waiting-on-carrier"
                >
                  <h2 className="bench-rail__section-label">
                    <span>{benchWorkCopy.tabs.waitingOnCarrier}</span>
                    <span className="mono">{visibleUnlabelled.length}</span>
                  </h2>
                  <ul className="bench-rail__list">
                    {visibleUnlabelled.map((parcel) => (
                      <BenchUnlabelledRow
                        key={parcel.workId}
                        parcel={parcel}
                        onOpenParcel={onOpenParcel}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {noBenchSectionMatches ? (
                <p className="bench-work-list__no-matches" data-testid="bench-search-no-matches">
                  {benchWorkCopy.tabs.noSectionMatches}
                </p>
              ) : null}
            </>
          ) : null}

          {activeTab === 'hold' ? (
            visibleDoNotPack.length === 0 ? (
              noHoldSectionMatches ? (
                <p className="bench-work-list__no-matches" data-testid="bench-search-no-matches">
                  {benchWorkCopy.tabs.noSectionMatches}
                </p>
              ) : (
                <p className="bench-work-list__no-matches">{benchWorkCopy.tabs.noPacksYet}</p>
              )
            ) : (
              renderSection(
                benchWorkCopy.tabs.onHoldHeading,
                visibleDoNotPack,
                'bench-section-do-not-pack',
                'bench-rail__section-label--hold'
              )
            )
          ) : null}

          {activeTab === 'done' ? (
            <section className="bench-rail__section" data-testid="bench-section-packed-today">
              <h2 className="bench-rail__section-label">
                <span>{benchWorkCopy.tabs.done}</span>
                <span className="mono">{bothCounts.done}</span>
              </h2>
              {visiblePackedToday.length === 0 ? (
                <p className="bench-work-list__no-matches" data-testid="bench-search-no-matches">
                  {noDoneSectionMatches
                    ? benchWorkCopy.tabs.noSectionMatches
                    : benchWorkCopy.tabs.noPacksYet}
                </p>
              ) : (
                <>
                  <ul className="bench-rail__list">
                    {visiblePackedToday.map((row) => (
                      <BenchPackedTodayRow key={row.workId} row={row} />
                    ))}
                  </ul>
                  <p className="bench-work-list__done-note">{benchWorkCopy.tabs.doneNote}</p>
                </>
              )}
            </section>
          ) : null}
        </div>
      )}

      {/* Said rather than left to be discovered: the read is capped, and a
          truncated list must not look like the whole of the work. */}
      {(query.data?.total ?? 0) > works.length ? (
        <p className="bench-work-list__truncated">{benchWorkCopy.truncated.note}</p>
      ) : null}

      <footer className="bench-work-list__footer">
        {/* Two lines, from five. This footer carried a page of manual under a
            list a packer works at speed: how the search box matches (the
            placeholder already shows that), what "routed here" means and which
            orders never appear (system vocabulary a packer holding a tote does
            not need), and that the list refreshes itself (the empty state
            already says so, where it matters).

            What survives is what nothing else says: whose bench this is and
            the order the rows are in, and the one fact a packer could
            otherwise read wrong — the counts describe what must GO OUT, not
            what is on the shelf. `bench-work.copy.test.ts` asserts that second
            line exists, so it is a guard rather than a preference. */}
        <span>
          {query.data?.executorName ?? benchWorkCopy.header.fallbackTitle} ·{' '}
          {benchWorkCopy.header.orderingNote}
        </span>
        <span>{benchWorkCopy.footer.honesty}</span>
      </footer>
    </div>
  );
}
