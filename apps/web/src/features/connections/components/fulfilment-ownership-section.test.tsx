/**
 * FulfilmentOwnershipSection tests (#2118)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FulfilmentOwnershipSection } from './fulfilment-ownership-section';

function Harness({
  initial,
  configIsParseable = true,
  sync,
}: {
  initial: boolean;
  configIsParseable?: boolean;
  sync: () => void;
}): JSX.Element {
  const form = useForm<any>({ defaultValues: { fulfilmentOwnedByDestination: initial } });
  return (
    <>
      <FulfilmentOwnershipSection
        form={form}
        configIsParseable={configIsParseable}
        syncFulfilmentOwnershipToJson={sync}
      />
      <output data-testid="value">{String(form.watch('fulfilmentOwnedByDestination'))}</output>
    </>
  );
}

describe('FulfilmentOwnershipSection', () => {
  afterEach(cleanup);

  it('should render the checkbox in operator language, unchecked by default', () => {
    render(<Harness initial={false} sync={vi.fn()} />);

    const checkbox = screen.getByTestId('fulfilment-owned-by-destination-checkbox');
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('This system packs and ships orders itself')).toBeInTheDocument();
  });

  it('should set the form value, then serialize to the raw JSON, when toggled', () => {
    const sync = vi.fn();
    render(<Harness initial={false} sync={sync} />);

    fireEvent.click(screen.getByTestId('fulfilment-owned-by-destination-checkbox'));

    expect(screen.getByTestId('value')).toHaveTextContent('true');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('should be disabled while the raw JSON does not parse', () => {
    render(<Harness initial={true} configIsParseable={false} sync={vi.fn()} />);

    expect(screen.getByTestId('fulfilment-owned-by-destination-checkbox')).toBeDisabled();
  });
});
