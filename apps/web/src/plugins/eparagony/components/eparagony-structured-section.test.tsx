/**
 * EparagonyStructuredSection tests (#3266)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does.
 * Pins the three things a regression would hide rather than break loudly: the
 * sync routing per field, the unparseable-JSON lock (an enabled control there
 * discards the edit silently), and the three-state print switch.
 *
 * @module plugins/eparagony/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { EparagonyStructuredSection } from './eparagony-structured-section';

const eparagonyConnection: Connection = {
  ...sampleConnection,
  id: 'eparagony_1',
  name: 'eparagony.pl',
  platformType: 'eparagony',
  config: { environment: 'sandbox', posId: 'openlinker' },
  adapterKey: 'eparagony.documents.v3',
};

interface HarnessProps {
  configIsParseable?: boolean;
  syncStructuredToJson?: (field: string, value: string) => void;
  defaultValues?: Record<string, unknown>;
}

function Harness({
  configIsParseable = true,
  syncStructuredToJson = vi.fn(),
  defaultValues = {},
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      eparagonyPrint: '',
      eparagonyPaymentForm: '',
      eparagonyPaymentName: '',
      eparagonyDefaultTaxRateCode: '',
      eparagonyStatusPollTimeoutMs: '',
      eparagonyFiscalDeviceUniqueNumber: '',
      eparagonyApiBaseUrl: '',
      eparagonyAuthBaseUrl: '',
      ...defaultValues,
    },
  });
  return (
    <EparagonyStructuredSection
      connection={eparagonyConnection}
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
    />
  );
}

afterEach(cleanup);

describe('EparagonyStructuredSection', () => {
  it('should render the receipt fields without the operator opening anything', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Paper receipt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Payment form on the receipt')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment name')).toBeInTheDocument();
  });

  it('should offer every vendor payment form plus a default option', () => {
    renderWithProviders(<Harness />);
    const select = screen.getByLabelText('Payment form on the receipt');
    // 10 vendor values + the "use the default" entry.
    expect(select.querySelectorAll('option')).toHaveLength(11);
    expect(screen.getByRole('option', { name: 'Przelew (bank transfer)' })).toBeInTheDocument();
  });

  it('should sync a payment form choice under its own field name', () => {
    const sync = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={sync} />);
    fireEvent.change(screen.getByLabelText('Payment form on the receipt'), {
      target: { value: 'Karta' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyPaymentForm', 'Karta');
  });

  it('should sync each of the three print states', () => {
    const sync = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={sync} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Print' }));
    expect(sync).toHaveBeenCalledWith('eparagonyPrint', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Do not print' }));
    expect(sync).toHaveBeenCalledWith('eparagonyPrint', 'false');
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    expect(sync).toHaveBeenCalledWith('eparagonyPrint', '');
  });

  it('should check the print state the config was hydrated with', () => {
    renderWithProviders(<Harness defaultValues={{ eparagonyPrint: 'false' }} />);
    expect(screen.getByRole('radio', { name: 'Do not print' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Print' })).toHaveAttribute('aria-checked', 'false');
  });

  it('should lock every control while the raw JSON is unparseable', () => {
    // The host serializer early-returns in this state, so an enabled control
    // would take the edit and silently drop it.
    renderWithProviders(<Harness configIsParseable={false} />);
    expect(screen.getByLabelText('Payment form on the receipt')).toBeDisabled();
    expect(screen.getByLabelText('Payment name')).toBeDisabled();
    for (const option of screen.getAllByRole('radio')) {
      expect(option).toBeDisabled();
    }
  });

  it('should summarise the fallback slot on the collapsed disclosure', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('Not set (recommended)')).toBeInTheDocument();

    cleanup();
    renderWithProviders(<Harness defaultValues={{ eparagonyDefaultTaxRateCode: 'B' }} />);
    // Scoped to the summary: the same text is also an <option> inside the
    // select this disclosure wraps.
    expect(
      screen.getByText('Slot B', { selector: '.inline-disclosure__value' }),
    ).toBeInTheDocument();
  });

  it('should explain the fallback hazard on demand, including that it can fire by default', () => {
    renderWithProviders(<Harness />);
    fireEvent.click(
      screen.getByRole('button', { name: 'What the fallback tax rate does, and why it is risky' }),
    );
    expect(screen.getByText('Why setting it is risky')).toBeInTheDocument();
    expect(
      screen.getByText('On a standard installation it is off, so this fallback can fire.'),
    ).toBeInTheDocument();
  });

  it('should sync the diagnostic and testing fields under their own names', () => {
    const sync = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={sync} />);

    fireEvent.change(screen.getByLabelText('Device wait time (ms)'), {
      target: { value: '30000' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyStatusPollTimeoutMs', '30000');

    fireEvent.change(screen.getByLabelText('Fiscal device number'), { target: { value: 'DEV-1' } });
    expect(sync).toHaveBeenCalledWith('eparagonyFiscalDeviceUniqueNumber', 'DEV-1');

    fireEvent.change(screen.getByLabelText('API host'), {
      target: { value: 'https://api.eparagony.pl' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyApiBaseUrl', 'https://api.eparagony.pl');

    fireEvent.change(screen.getByLabelText('Sign-in host'), {
      target: { value: 'https://login.eparagony.pl' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyAuthBaseUrl', 'https://login.eparagony.pl');
  });

  it('should say the device number is diagnostic only', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText(/never sent on a receipt/i)).toBeInTheDocument();
  });

  it('should keep the infotip out of the fallback select’s accessible name', () => {
    // The infotip button sits next to the label. `FormField` renders the label
    // as `<label htmlFor>`, and an accessible name is computed from that
    // label's subtree — so a button placed inside it would fold its own
    // `aria-label` into the select's name and leave the control announced as
    // "Fallback device slot What the fallback tax rate does, and why it is
    // risky". This pins the name to the field's own words.
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText('Fallback device slot')).toBeInTheDocument();
  });

  it('should not offer the tax rate slot table, which stays raw-JSON-only', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByLabelText(/slot a rate/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/tax rates/i)).not.toBeInTheDocument();
  });
});
