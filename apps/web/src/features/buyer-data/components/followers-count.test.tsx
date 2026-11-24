/**
 * FollowersCount tests (#4289)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import { FollowersCount } from './followers-count';

function make(n: number): Connection[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    name: `Shop ${i}`,
    platformType: 'prestashop',
    config: {},
  })) as unknown as Connection[];
}

afterEach(cleanup);

describe('FollowersCount (#4289)', () => {
  it('should render plain 0 with no trigger when nobody follows', () => {
    renderWithProviders(<FollowersCount connections={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should open the list of connections on keyboard focus', async () => {
    renderWithProviders(<FollowersCount connections={make(2)} />);
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent('2');
    await userEvent.tab();
    expect(screen.getByTestId('followers-list')).toHaveTextContent('Shop 0');
    expect(screen.getByTestId('followers-list')).toHaveTextContent('Shop 1');
    expect(screen.getByTestId('followers-list')).not.toHaveClass('followers-pop__list--scroll');
  });

  it('should open on hover with a mouse', () => {
    renderWithProviders(<FollowersCount connections={make(2)} />);
    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' });
    expect(screen.getByTestId('followers-list')).toBeInTheDocument();
  });

  it('should scroll the list when there are more than six connections', async () => {
    renderWithProviders(<FollowersCount connections={make(8)} />);
    await userEvent.tab();
    expect(screen.getByTestId('followers-list')).toHaveClass('followers-pop__list--scroll');
  });
});
