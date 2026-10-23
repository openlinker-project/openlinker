/**
 * Connection link-target resolver tests (#3670 review)
 *
 * The System / Unknown / self-page rules are pinned here once; the component
 * tests only check that each surface renders what the resolver decided.
 *
 * @module features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { SYSTEM_CONNECTION_ID } from '../api/connections.types';
import { isSystemConnectionId, resolveConnectionLinkTarget } from './connection-link-target';

const CONNECTION_ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';
const TARGET = `/connections/${CONNECTION_ID}`;

describe('resolveConnectionLinkTarget', () => {
  it('should link to the detail page with the name when the connection resolved', () => {
    expect(
      resolveConnectionLinkTarget({
        connectionId: CONNECTION_ID,
        name: 'Erli Demo',
        loading: false,
        pathname: '/orders',
      }),
    ).toEqual({
      system: false,
      targetPath: TARGET,
      linked: true,
      loading: false,
      unknown: false,
      displayName: 'Erli Demo',
      text: 'Erli Demo',
      title: undefined,
    });
  });

  it('should render System without a link when the id is the placeholder', () => {
    const target = resolveConnectionLinkTarget({
      connectionId: SYSTEM_CONNECTION_ID,
      name: null,
      loading: true,
      pathname: '/sync-jobs',
    });

    expect(target.system).toBe(true);
    expect(target.linked).toBe(false);
    expect(target.displayName).toBe('System');
    expect(target.text).toBe('System');
    expect(target.title).toBe('Not tied to a specific connection');
    // System needs no lookup, so a page-level loading flag never blanks it.
    expect(target.loading).toBe(false);
    expect(target.unknown).toBe(false);
  });

  it('should render Unknown with the raw id in the title when the lookup settled without a connection', () => {
    const target = resolveConnectionLinkTarget({
      connectionId: CONNECTION_ID,
      name: null,
      loading: false,
      pathname: '/orders',
    });

    expect(target.unknown).toBe(true);
    expect(target.displayName).toBeNull();
    expect(target.text).toBe('Unknown');
    expect(target.title).toBe(CONNECTION_ID);
  });

  it('should render a loading placeholder rather than Unknown when the lookup has not settled', () => {
    const target = resolveConnectionLinkTarget({
      connectionId: CONNECTION_ID,
      name: null,
      loading: true,
      pathname: '/orders',
    });

    expect(target.loading).toBe(true);
    expect(target.unknown).toBe(false);
    expect(target.text).toBe('…');
    expect(target.title).toBeUndefined();
  });

  it('should not link when already on the connection page', () => {
    const target = resolveConnectionLinkTarget({
      connectionId: CONNECTION_ID,
      name: 'Erli Demo',
      loading: false,
      pathname: TARGET,
    });

    expect(target.linked).toBe(false);
    expect(target.displayName).toBe('Erli Demo');
  });

  it('should not link when the caller opts out of the link', () => {
    const target = resolveConnectionLinkTarget({
      connectionId: CONNECTION_ID,
      name: 'Erli Demo',
      loading: false,
      pathname: '/orders',
      linkToDetail: false,
    });

    expect(target.linked).toBe(false);
  });
});

describe('isSystemConnectionId', () => {
  it('should recognise only the all-zero placeholder id', () => {
    expect(isSystemConnectionId(SYSTEM_CONNECTION_ID)).toBe(true);
    expect(isSystemConnectionId(CONNECTION_ID)).toBe(false);
  });
});
