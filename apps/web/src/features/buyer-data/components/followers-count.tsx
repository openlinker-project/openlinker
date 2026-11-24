/**
 * Followers Count (#4289)
 *
 * The number in "counted for the connections that follow the defaults: 2" is
 * the one place an operator asks "which ones?". It opens the shared popover on
 * hover, on keyboard focus and on a tap, and lists the connections with the
 * same chip every list uses, one under another, all as wide as the widest. The
 * popover renders in a portal, so the sticky rail cannot clip it. Zero followers
 * is plain text: there is nothing to list.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { interpolate } from '../../../shared/i18n';
import { useMessages } from '../../../shared/i18n';
import { usePlatforms } from '../../../shared/plugins';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import {
  ConnectionChip,
  readConnectionEnvironment,
  type Connection,
} from '../../connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../mappings';

const CLOSE_DELAY_MS = 120;
const SETTINGS_PATH = '/settings/buyer-data';

export interface FollowersCountProps {
  connections: readonly Connection[];
  /** Above this many rows the list scrolls instead of growing. */
  scrollAfter?: number;
}

export function FollowersCount({
  connections,
  scrollAfter = 6,
}: FollowersCountProps): ReactElement {
  const copy = useMessages('buyer-data').scope;
  const platforms = usePlatforms();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const findDialog = useCallback((el: HTMLButtonElement | null): void => {
    if (el !== null) setContainer(el.closest<HTMLElement>('dialog, [role="dialog"]'));
  }, []);

  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (): void => {
    cancel();
    setOpen(true);
  };
  const hideSoon = (): void => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  // A connection here is a scope of the page that lists it: following it
  // switches that page's scope tab in place, keeping its other query params.
  const scopeTarget = (id: string): string => {
    const params = new URLSearchParams(
      location.pathname === SETTINGS_PATH ? searchParams : undefined
    );
    params.set('scope', id);
    return `${SETTINGS_PATH}?${params.toString()}`;
  };

  if (connections.length === 0) {
    return <span className="followers-count__plain">0</span>;
  }

  const scrolls = connections.length > scrollAfter;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          ref={findDialog}
          className="followers-count"
          aria-label={`${connections.length}: ${copy.followersListLabel}`}
          data-testid="followers-count"
          onPointerDown={(event) => {
            touched.current = event.pointerType === 'touch';
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') show();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') hideSoon();
          }}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) show();
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !next.parentElement?.closest('.followers-pop')) {
              hideSoon();
            }
          }}
          onClick={(event) => {
            // A tap is a plain toggle (Radix). A click that follows a hover or a
            // focus must not close what that already opened.
            if (!touched.current) {
              event.preventDefault();
              show();
            }
          }}
        >
          {connections.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="followers-pop"
        align="start"
        sideOffset={6}
        aria-label={copy.followersListLabel}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Focus handed back to the trigger would reopen it through its onFocus.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={show}
        onPointerLeave={hideSoon}
      >
        <ul
          className={`followers-pop__list${scrolls ? ' followers-pop__list--scroll' : ''}`}
          data-testid="followers-list"
        >
          {connections.map((connection) => (
            <li key={connection.id}>
              <ConnectionChip
                className="followers-pop__chip"
                connectionId={connection.id}
                to={scopeTarget(connection.id)}
                onNavigate={() => {
                  cancel();
                  setOpen(false);
                }}
                linkLabel={interpolate(copy.openScope, { name: connection.name })}
                name={connection.name}
                channel={{
                  platformType: connection.platformType,
                  label: resolvePlatformLabel(platforms, connection.platformType),
                  shortLabel: resolvePlatformShortLabel(platforms, connection.platformType),
                  environment: readConnectionEnvironment(connection.config),
                }}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
