/**
 * Bulk wizard leave guard (#3851)
 *
 * The wizard keeps every operator edit (per-variant title, price, images,
 * parameters, the chosen category, inclusion) in component state, so a sidebar
 * link, browser back or a tab close dropped all of it with no warning. This
 * guard asks before that happens:
 *
 *   - in-app navigation is held by React Router's `useBlocker` and confirmed in
 *     the same discard dialog shape the per-product editor uses;
 *   - a reload or tab close raises the browser's own `beforeunload` prompt (the
 *     only thing a page may do there - the copy is the browser's).
 *
 * `released` is a ref rather than a prop because the submit path flips it and
 * navigates in the same tick: a state update would not reach the registered
 * blocker function before the navigation it must let through.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, type ReactElement, type RefObject } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { useMessages } from '../../../../shared/i18n';
import { ConfirmDialog } from '../../../../shared/ui';

interface BulkWizardLeaveGuardProps {
  /** True while the wizard holds operator edits that nothing has submitted yet. */
  active: boolean;
  /** Set to `true` by a successful submit, so the navigation it starts is never held. */
  released: RefObject<boolean>;
}

/** Needs a data router (`useBlocker` throws outside one); the app mounts `createBrowserRouter`. */
export function BulkWizardLeaveGuard({ active, released }: BulkWizardLeaveGuardProps): ReactElement {
  useEffect(() => {
    if (!active) return;
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (released.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active, released]);

  return <NavigationBlocker active={active} released={released} />;
}

function NavigationBlocker({ active, released }: BulkWizardLeaveGuardProps): ReactElement {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      active &&
      !released.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
    [active, released],
  );
  const blocker = useBlocker(shouldBlock);
  const copy = useMessages('listings').bulkWizardLeaveGuard;

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset();
      }}
      title={copy.title}
      description={copy.description}
      cancelLabel={copy.keepEditing}
      confirmLabel={copy.discardAndLeave}
      tone="danger"
      initialFocus="cancel"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
    />
  );
}
