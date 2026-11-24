import { useEffect, useRef, useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { canArchive, hasMissingCredentials } from '../api/connections.types';
import { useDisableConnectionMutation } from '../hooks/use-disable-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { EnableConnectionButton } from './EnableConnectionButton';
import { ArchiveConnectionButton } from './archive-connection-button';
import { RestoreConnectionButton } from './restore-connection-button';
import { usePlatform } from '../../../shared/plugins';
import { TriggerSyncDialog } from '../../sync-jobs';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { captureDemoEvent } from '../../demo';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { describeConnectionTestFailure } from '../lib/describe-connection-test-failure';
import { GUIDED_DIALOG_FALLBACK_MS, onGuidedLanded, readLiveLocation } from '../lib/guided-jump';
import { prefersMotion } from '../../../shared/ui/prefers-motion';

/** Which job the trigger dialog opens on, by the `?sync=` value another tab sends. */
const SYNC_TARGET_JOB: Record<string, string | undefined> = {
  orders: 'marketplace.orders.poll',
  products: 'master.product.syncAll',
};

interface ConnectionActionsPanelProps {
  connection: Connection;
  /** Replaces "Edit connection" for a connection configured elsewhere (the OMS). */
  settingsLink?: { to: string; label: string };
}

export function ConnectionActionsPanel({ connection, settingsLink }: ConnectionActionsPanelProps): ReactElement {
  const copy = useMessages('connections').connectionActionsPanel;
  const format = useFormat();
  const disableConnection = useDisableConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);
  // The Orders tab sends the operator here with ?sync=orders (or =products): the dialog
  // opens on that job, and the param is dropped so a reload does not reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [triggerInitialJob, setTriggerInitialJob] = useState<string | undefined>(undefined);
  const [triggerInitialScope, setTriggerInitialScope] = useState<'new' | 'range'>('new');
  const location = useLocation();
  const guided = (location.state as { guided?: boolean } | null)?.guided === true;
  const plugin = usePlatform(connection.platformType);
  const PluginActions = plugin?.ConnectionActions;

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const sync = useWriteAccess('sync:write', demoMode);

  // Not cleared when the params drop (that re-runs the effect below), only on unmount.
  const cancelGuidedOpen = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelGuidedOpen.current?.(), []);
  // The first dialog open after a guided arrival gets its own entrance; ordinary opens do not.
  const [triggerGuidedEntrance, setTriggerGuidedEntrance] = useState(false);

  const syncTarget = SYNC_TARGET_JOB[searchParams.get('sync') ?? ''];
  const wantsRange = syncTarget === 'marketplace.orders.poll' && searchParams.get('scope') === 'range';
  useEffect(() => {
    if (!syncTarget || !sync.visible) return;
    // The params are dropped at once (so a reload never reopens the dialog), but the history
    // state stays: the page still needs its guided flag to finish the tab animation. The state
    // is read live: the page may have just cleared the flag in this same tick, and writing back
    // the render's copy would bring it back.
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete('sync');
        params.delete('scope');
        return params;
      },
      { replace: true, state: readLiveLocation(location).state }
    );
    const open = (guidedEntrance: boolean): void => {
      setTriggerGuidedEntrance(guidedEntrance);
      setTriggerInitialJob(syncTarget);
      setTriggerInitialScope(wantsRange ? 'range' : 'new');
      setIsTriggerDialogOpen(true);
    };
    // After a guided arrival the dialog chains to the tab underline landing, so the operator
    // sees where they were taken first. Without motion (or without a guided arrival) it opens now.
    if (!guided || !prefersMotion()) {
      open(false);
      return;
    }
    let opened = false;
    let timer = 0;
    let unsubscribe = (): void => undefined;
    const fire = (): void => {
      if (opened) return;
      opened = true;
      window.clearTimeout(timer);
      unsubscribe();
      open(true);
    };
    unsubscribe = onGuidedLanded(fire);
    timer = window.setTimeout(fire, GUIDED_DIALOG_FALLBACK_MS);
    cancelGuidedOpen.current = () => {
      opened = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival; the params are dropped by this very effect
  }, [syncTarget, wantsRange, sync.visible]);

  const isDisabled = connection.status === 'disabled';
  // #3657 — an archived connection has no credential and resolves no adapter,
  // so Test / Trigger sync / Disable / Enable would all fail. Restore is the
  // only action that means anything there.
  const isArchived = connection.status === 'archived';

  async function handleTest(): Promise<void> {
    try {
      const result = await testConnection.mutateAsync(connection.id);
      if (result.success) {
        showToast({
          tone: 'success',
          description: interpolate(copy.test.ok, { ms: format.number(result.latencyMs) }),
        });
        return;
      }
      const details = describeConnectionTestFailure(result);
      showToast({
        tone: 'error',
        title: copy.test.failed,
        description:
          result.status === undefined
            ? details
            : interpolate(copy.test.failedWithStatus, {
                message: details,
                status: result.status,
              }),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.test.failed,
        description: describeApiError(error, 'connections'),
      });
    }
  }

  if (isArchived) {
    return (
      <div className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 className="section-title">{copy.title}</h3>
          </div>
          <span className="panel__meta">{copy.meta}</span>
        </div>
        <div className="action-list">
          {write.visible ? (
            <div className="action-list__item">
              <div>
                <strong>{copy.restore.title}</strong>
                <p className="muted-text">
                  {copy.restore.help}
                </p>
              </div>
              <RestoreConnectionButton connection={connection} />
            </div>
          ) : (
            <p className="muted-text">{copy.archived}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.meta}</span>
      </div>

      {disableConnection.error ? (
        <Alert tone="error" title={copy.disable.errorTitle}>
          {describeApiError(disableConnection.error, 'connections')}
        </Alert>
      ) : null}

      <div className="action-list">
        {write.visible ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.test.title}</strong>
              <p className="muted-text">
                {copy.test.help}
              </p>
            </div>
            <ReadOnlyLock
              active={write.demoReadOnly}
              message={demoReadOnlyActionMessage()}
              onLockedClick={() =>
                captureDemoEvent('demo_connection_test_attempted', { platform: connection.platformType })
              }
            >
              <Button
                tone="secondary"
                disabled={testConnection.isPending || write.demoReadOnly}
                onClick={() => void handleTest()}
              >
                {testConnection.isPending ? copy.test.testing : copy.test.title}
              </Button>
            </ReadOnlyLock>
          </div>
        ) : null}

        {write.visible && settingsLink ? (
          <div className="action-list__item">
            <div>
              <strong>{settingsLink.label}</strong>
              <p className="muted-text">{copy.settings.help}</p>
            </div>
            <Link className="button button--secondary" to={settingsLink.to}>
              {copy.settings.open}
            </Link>
          </div>
        ) : null}

        {write.visible && !settingsLink ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.edit.title}</strong>
              <p className="muted-text">{copy.edit.help}</p>
            </div>
            <Link className="button button--secondary" to={`/connections/${connection.id}/edit`}>
              {copy.edit.action}
            </Link>
          </div>
        ) : null}

        {write.visible && PluginActions ? (
          <PluginActions connection={connection} readOnly={write.demoReadOnly} />
        ) : null}

        {sync.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.sync.title}</strong>
              <p className="muted-text">
                {copy.sync.help}
              </p>
            </div>
            <Button
              tone="primary"
              onClick={() => {
                captureDemoEvent('demo_connection_sync_dialog_opened', {});
                setTriggerInitialJob(undefined);
                setTriggerInitialScope('new');
                setIsTriggerDialogOpen(true);
              }}
            >
              {copy.sync.action}
            </Button>
          </div>
        ) : null}

        {write.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.disable.title}</strong>
              <p className="muted-text">{copy.disable.help}</p>
            </div>
            <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <Button
                tone="danger"
                onClick={() => setIsDisableDialogOpen(true)}
                disabled={disableConnection.isPending || write.demoReadOnly}
              >
                {disableConnection.isPending ? copy.disable.disabling : copy.disable.action}
              </Button>
            </ReadOnlyLock>
          </div>
        ) : null}

        {write.visible && isDisabled && !hasMissingCredentials(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.enable.title}</strong>
              <p className="muted-text">
                {copy.enable.help}
              </p>
            </div>
            <EnableConnectionButton connection={connection} />
          </div>
        ) : null}

        {write.visible && isDisabled && !canArchive(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.archive.title}</strong>
              <p className="muted-text">{copy.archive.notArchivable}</p>
            </div>
          </div>
        ) : null}

        {write.visible && canArchive(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.archive.title}</strong>
              <p className="muted-text">{copy.archive.help}</p>
            </div>
            <ArchiveConnectionButton connection={connection} />
          </div>
        ) : null}
      </div>

      <TriggerSyncDialog
        connection={connection}
        open={isTriggerDialogOpen}
        onOpenChange={setIsTriggerDialogOpen}
        submitDisabled={sync.demoReadOnly}
        initialJobType={triggerInitialJob}
        initialOrderScope={triggerInitialScope}
        guidedEntrance={triggerGuidedEntrance}
      />

      <ConfirmDialog
        open={isDisableDialogOpen}
        onOpenChange={setIsDisableDialogOpen}
        title={copy.disable.dialogTitle}
        description={interpolate(copy.disable.dialogDescription, { name: connection.name })}
        confirmLabel={copy.disable.title}
        cancelLabel={copy.disable.cancel}
        tone="danger"
        onConfirm={async () => {
          try {
            await disableConnection.mutateAsync(connection.id);
            setIsDisableDialogOpen(false);
            showToast({
              tone: 'success',
              title: copy.disable.doneTitle,
              description: interpolate(copy.disable.doneDescription, { name: connection.name }),
            });
          } catch {
            setIsDisableDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
