/**
 * Release dialog host (#4147, ADR-086)
 *
 * Decides, from the stored cursor and the build's changelog, whether the update
 * dialog opens, and writes the cursor when it closes. Mount once inside the
 * authenticated layout. It opens nothing for a patch, an empty cursor (that one
 * is initialised silently), a downgrade, a user who ticked "Don't show again",
 * or a cursor write that was already rejected this page life.
 *
 * @module features/release-center/components
 */
import { walkableSteps } from '../tour/tour-stop';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import changelog from 'virtual:openlinker-changelog';
import { generatePath, useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../../../shared/config/app-version';
import { RELEASE_HIGHLIGHTS } from '../catalog/release-highlights';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useRejectedCursorVersions } from '../hooks/release-cursor-write-memory';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCursorMutation } from '../hooks/use-release-cursor-mutation';
import { useReleaseStateQuery, useReleaseCenterEnabled } from '../hooks/use-release-state-query';
import { useReleaseStepRows } from '../hooks/use-release-step-rows';
import { subscribeToWhatsNewRequests } from '../lib/release-center-requests';
import { useTour, type TourStepInput } from '../tour/tour-context';
import { shouldOpenDialog } from '../lib/should-open-dialog';
import { buildDialogHighlights, type ReleaseStepRow } from '../lib/release-dialog-content';
import { ReleaseDialog } from './release-dialog';

export const WHATS_NEW_PATH = '/whats-new';

export function stepPath(row: ReleaseStepRow): string {
  return generatePath(`/${row.step.routePattern}`, row.step.routeParams({
    connection: row.connection
      ? { id: row.connection.id, platformType: '', capabilities: [], config: {} }
      : null,
    unassignedCarrierMethods: null,
  }));
}

export function rowsToTourSteps(rows: readonly ReleaseStepRow[]): TourStepInput[] {
  return rows.map((row) => ({
    stepId: row.step.id,
    connectionId: row.connection?.id ?? null,
    importance: row.importance,
  }));
}

export function ReleaseDialogHost(): ReactElement | null {
  const enabled = useReleaseCenterEnabled();
  const { canWriteSteps } = useReleaseCenterAccess();
  const state = useReleaseStateQuery().data;
  const rejected = useRejectedCursorVersions();
  const cursorMutation = useReleaseCursorMutation();
  const navigate = useNavigate();
  const tour = useTour();
  const [dismissed, setDismissed] = useState(false);
  const written = useRef<string | null>(null);

  const cursor = state?.cursor?.lastSeenVersion ?? null;
  const skipDialog = state?.cursor?.skipDialog === true;
  const rows = useReleaseStepRows(cursor);

  const decision = useMemo(
    () => shouldOpenDialog(cursor, APP_VERSION, changelog.releases, RELEASE_STEPS),
    [cursor]
  );

  useEffect(
    () => subscribeToWhatsNewRequests(
        (request) =>
          void navigate(
            request.minor ? `${WHATS_NEW_PATH}?v=${encodeURIComponent(request.minor)}` : WHATS_NEW_PATH
          )
      ),
    [navigate]
  );

  const { mutate } = cursorMutation;
  useEffect(() => {
    if (!enabled || !state || rejected.has(APP_VERSION) || written.current === APP_VERSION) return;
    // A fresh install is initialised, and a user who opted out is moved forward,
    // both without a dialog.
    const target = decision.initialiseCursorTo ?? (decision.open && skipDialog ? APP_VERSION : null);
    if (!target) return;
    written.current = APP_VERSION;
    mutate({ version: target });
  }, [enabled, state, rejected, decision, skipDialog, mutate]);

  const content = useMemo(
    () =>
      cursor
        ? buildDialogHighlights(changelog.releases, cursor, APP_VERSION, (minor) => RELEASE_HIGHLIGHTS[minor] ?? [])
        : { highlights: [], overflow: 0 },
    [cursor]
  );

  const open =
    enabled && decision.open && !skipDialog && !dismissed && !rejected.has(APP_VERSION);
  const date = changelog.releases.find((r) => r.version === APP_VERSION)?.date ?? null;

  const close = (skip: boolean): void => {
    setDismissed(true);
    mutate(skip ? { version: APP_VERSION, skipDialog: true } : { version: APP_VERSION });
  };

  return (
    <ReleaseDialog
      open={open}
      version={APP_VERSION}
      date={date}
      highlights={content.highlights}
      overflow={content.overflow}
      rows={rows}
      canWriteSteps={canWriteSteps}
      onClose={close}
      onFullChangelog={(skip) => {
        close(skip);
        void navigate(WHATS_NEW_PATH);
      }}
      onStartGuide={(openRows, skip) => {
        close(skip);
        // Without the right to change settings the rows still list every step, but the walk skips the ones whose page is closed.
        const steps = walkableSteps(rowsToTourSteps(openRows), canWriteSteps);
        if (steps.length === 0) {
          void navigate(WHATS_NEW_PATH);
          return;
        }
        // The tour navigates to each step's screen itself.
        tour.start(steps);
      }}
    />
  );
}
