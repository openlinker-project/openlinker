/**
 * LabelPurchaseNotificationSection tests (#4097)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelPurchaseNotificationSection } from './label-purchase-notification-section';

function Harness({
  initial,
  configIsParseable = true,
  canWrite = true,
  sync,
}: {
  initial: boolean;
  configIsParseable?: boolean;
  canWrite?: boolean;
  sync: () => void;
}): ReactElement {
  const form = useForm<any>({ defaultValues: { notifyOnLabelPurchase: initial } });
  return (
    <>
      <LabelPurchaseNotificationSection
        form={form}
        configIsParseable={configIsParseable}
        canWrite={canWrite}
        syncLabelPurchaseNotificationToJson={sync}
      />
      <output data-testid="value">{String(form.watch('notifyOnLabelPurchase'))}</output>
    </>
  );
}

describe('LabelPurchaseNotificationSection', () => {
  afterEach(cleanup);

  it('should render the checkbox unchecked by default and say when the buyer is told', () => {
    render(<Harness initial={false} sync={vi.fn()} />);

    expect(screen.getByTestId('notify-on-label-purchase-checkbox')).not.toBeChecked();
    expect(
      screen.getByText('Notify the shop or marketplace when a label is bought'),
    ).toBeInTheDocument();
    expect(screen.getByText(/when the label is bought, not when the parcel/)).toBeInTheDocument();
  });

  it('should show the stored value as checked', () => {
    render(<Harness initial={true} sync={vi.fn()} />);

    expect(screen.getByTestId('notify-on-label-purchase-checkbox')).toBeChecked();
  });

  it('should set the form value, then serialize to the raw JSON, when toggled', () => {
    const sync = vi.fn();
    render(<Harness initial={false} sync={sync} />);

    fireEvent.click(screen.getByTestId('notify-on-label-purchase-checkbox'));

    expect(screen.getByTestId('value')).toHaveTextContent('true');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('should be disabled while the raw JSON does not parse', () => {
    render(<Harness initial={true} configIsParseable={false} sync={vi.fn()} />);

    expect(screen.getByTestId('notify-on-label-purchase-checkbox')).toBeDisabled();
  });

  it('should show the current value disabled for a session that cannot write', () => {
    render(<Harness initial={true} canWrite={false} sync={vi.fn()} />);

    const checkbox = screen.getByTestId('notify-on-label-purchase-checkbox');
    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
  });
});
