import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { renderWithProviders } from '../../../test/test-utils';
import { useWarningAcknowledgement } from './acknowledge-warning-dialog';

afterEach(() => cleanup());

const refusal = new ApiError('cancelled', 409, {
  code: 'ORDER_CANCELLED',
  params: { warningCode: 'order-cancelled' },
  error: 'OrderNotIssuable',
  warningCode: 'order-cancelled',
});

function Harness({
  resubmit,
  onOffered,
}: {
  resubmit: (codes: string[]) => void;
  onOffered: (handled: boolean) => void;
}): ReactElement {
  const ack = useWarningAcknowledgement();
  return (
    <>
      <button type="button" onClick={() => onOffered(ack.offer(refusal, resubmit))}>
        fail
      </button>
      <button type="button" onClick={() => onOffered(ack.offer(new Error('boom'), resubmit))}>
        other
      </button>
      {ack.dialog}
    </>
  );
}

describe('useWarningAcknowledgement', () => {
  it('should open a dialog with the sentence for the code and resubmit with the code on confirm', async () => {
    const resubmit = vi.fn();
    const onOffered = vi.fn();
    renderWithProviders(<Harness resubmit={resubmit} onOffered={onOffered} />);

    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(onOffered).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText(getMessages('errors').codes.ORDER_CANCELLED)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(resubmit).toHaveBeenCalledWith(['order-cancelled']));
  });

  it('should not ask twice for a code already confirmed', async () => {
    const resubmit = vi.fn();
    const onOffered = vi.fn();
    renderWithProviders(<Harness resubmit={resubmit} onOffered={onOffered} />);

    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(resubmit).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(onOffered).toHaveBeenLastCalledWith(false);
  });

  it('should leave any other error to the caller', () => {
    const onOffered = vi.fn();
    renderWithProviders(<Harness resubmit={vi.fn()} onOffered={onOffered} />);
    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(onOffered).toHaveBeenLastCalledWith(false);
  });
});
