/**
 * InvoicingPrimarySection tests (#2047)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvoicingPrimarySection } from './invoicing-primary-section';

const TOGGLE_LABEL = 'Auto-issue invoices on this connection';

interface HarnessProps {
  configIsParseable?: boolean;
  syncInvoicingPrimaryToJson?: () => void;
  initialIsPrimary?: boolean;
  invoicingConnectionCount?: number;
}

function Harness({
  configIsParseable = true,
  syncInvoicingPrimaryToJson = (): void => {},
  initialIsPrimary = false,
  invoicingConnectionCount = 2,
}: HarnessProps): ReactElement {
  const form = useForm<any>({ defaultValues: { invoicingIsPrimary: initialIsPrimary } });
  return (
    <InvoicingPrimarySection
      form={form as any}
      configIsParseable={configIsParseable}
      syncInvoicingPrimaryToJson={syncInvoicingPrimaryToJson}
      invoicingConnectionCount={invoicingConnectionCount}
    />
  );
}

describe('InvoicingPrimarySection', () => {
  afterEach(cleanup);

  it('hydrates from the persisted flag rather than always starting unchecked', () => {
    render(<Harness initialIsPrimary />);
    expect(screen.getByLabelText(TOGGLE_LABEL)).toBeChecked();
  });

  it('renders unchecked when the connection does not claim the primary role', () => {
    render(<Harness />);
    expect(screen.getByLabelText(TOGGLE_LABEL)).not.toBeChecked();
  });

  it('re-serializes into the config JSON after toggling', () => {
    // ORDERING TRAP: the sync reads current form state, so it must run AFTER
    // setValue. Asserting it is called at all is what catches a wiring drop —
    // without it the checkbox flips, the form looks dirty, and Save writes
    // nothing.
    const sync = vi.fn();
    render(<Harness syncInvoicingPrimaryToJson={sync} />);

    fireEvent.click(screen.getByLabelText(TOGGLE_LABEL));

    expect(screen.getByLabelText(TOGGLE_LABEL)).toBeChecked();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('explains the silent-by-design consequence when several connections compete', () => {
    render(<Harness invoicingConnectionCount={2} />);
    expect(screen.getByText(/issues/i).textContent).toContain('nothing');
    expect(screen.queryByText(/only connection that can issue invoices/i)).toBeNull();
  });

  it('says the flag is inert when this is the only invoicing connection', () => {
    // Otherwise a single-connection operator reads the multi-connection warning
    // and believes their invoicing is off when it is working normally.
    render(<Harness invoicingConnectionCount={1} />);
    expect(screen.getByText(/only connection that can issue invoices/i)).toBeInTheDocument();
  });

  it('warns about a second primary only while this one claims the role', () => {
    // Driven by the checkbox rather than by re-rendering with new defaults:
    // `useForm` reads `defaultValues` once, so a rerender would leave the field
    // untouched and the assertion would pass for the wrong reason.
    render(<Harness initialIsPrimary invoicingConnectionCount={2} />);
    expect(screen.getByText(/Marking another connection primary as well/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(TOGGLE_LABEL));

    expect(screen.getByLabelText(TOGGLE_LABEL)).not.toBeChecked();
    expect(screen.queryByText(/Marking another connection primary as well/i)).toBeNull();
  });

  it('disables the toggle while the raw config JSON is unparseable', () => {
    render(<Harness configIsParseable={false} />);
    expect(screen.getByLabelText(TOGGLE_LABEL)).toBeDisabled();
  });
});
