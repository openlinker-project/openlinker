import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/api-error';
import { QueryErrorState, type QueryErrorStateCopy } from './query-error-state';

afterEach(cleanup);

const COPY: QueryErrorStateCopy = {
  error: { title: 'Could not load', message: 'Try again.', retry: 'Retry' },
  notFound: { title: 'Not found', message: 'Nothing here.' },
  denied: { title: 'No access here', message: 'Ask an admin.' },
};

describe('QueryErrorState', () => {
  it('should render the denied state with no Retry when the error is a 403', () => {
    render(
      <QueryErrorState error={new ApiError('Forbidden', 403, null)} onRetry={vi.fn()} copy={COPY} />
    );

    expect(screen.getByRole('heading', { name: 'No access here' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('should render the not-found state when the error is a 404 and copy is given', () => {
    render(
      <QueryErrorState error={new ApiError('Missing', 404, null)} onRetry={vi.fn()} copy={COPY} />
    );

    expect(screen.getByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should fall back to the error state when a 404 arrives with no not-found copy', () => {
    render(
      <QueryErrorState
        error={new ApiError('Missing', 404, null)}
        onRetry={vi.fn()}
        copy={{ error: COPY.error }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Could not load' })).toBeInTheDocument();
  });

  it('should offer a working Retry when the error is anything else', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<QueryErrorState error={new ApiError('Boom', 500, null)} onRetry={onRetry} copy={COPY} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should use the generic denied copy when the caller gives none', () => {
    render(
      <QueryErrorState
        error={new ApiError('Forbidden', 403, null)}
        onRetry={vi.fn()}
        copy={{ error: COPY.error }}
      />
    );

    expect(screen.getByRole('heading', { name: "You don't have access to this" })).toBeInTheDocument();
  });
});
