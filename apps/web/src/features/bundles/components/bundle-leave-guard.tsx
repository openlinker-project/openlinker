/**
 * Bundle leave guard (#3624)
 *
 * The wizard keeps the components, the product draft and the gift marks in
 * component state until the last step saves them, so a sidebar link, the browser
 * back button or a closed tab dropped all of it silently. This asks first.
 *
 * Unlike the bulk wizard's guard it ignores a change of the query string: the
 * step lives in `?krok=`, and moving between steps must never ask. `released`
 * is a ref because a successful create flips it and navigates in the same tick.
 *
 * It needs a data router (`useBlocker` throws outside one), so it renders
 * nothing under a plain router (the form still works, it just cannot guard).
 *
 * @module apps/web/src/features/bundles/components
 */
import { useCallback, useContext, useEffect, type ReactElement, type RefObject } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, type BlockerFunction } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';
import { ConfirmDialog } from '../../../shared/ui';

interface BundleLeaveGuardProps {
  /** True while the form holds work that nothing has saved yet. */
  active: boolean;
  /** Set to `true` just before a navigation that must not be held. */
  released: RefObject<boolean>;
}

export function BundleLeaveGuard(props: BundleLeaveGuardProps): ReactElement | null {
  const router = useContext(UNSAFE_DataRouterContext);
  const { active, released } = props;

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

  return router === null ? null : <NavigationBlocker {...props} />;
}

function NavigationBlocker({ active, released }: BundleLeaveGuardProps): ReactElement {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      active && !released.current && currentLocation.pathname !== nextLocation.pathname,
    [active, released]
  );
  const blocker = useBlocker(shouldBlock);
  const copy = useMessages('bundles').form;

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset();
      }}
      title={copy.leaveTitle}
      description={copy.leaveBody}
      cancelLabel={copy.leaveStay}
      confirmLabel={copy.leaveDiscard}
      tone="danger"
      initialFocus="cancel"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
    />
  );
}
