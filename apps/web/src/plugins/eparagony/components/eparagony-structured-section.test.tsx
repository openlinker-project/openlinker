/**
 * EparagonyStructuredSection tests (#3266)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does.
 * Pins the things a regression would hide rather than break loudly: the sync
 * routing per field, the unparseable-JSON lock (an enabled control there
 * discards the edit silently), the three-state print switch, and — since the
 * #3268 review — the accessibility wiring of the radiogroup, the collapsed
 * groups' error reflection, and the unrecognised-stored-value warning.
 *
 * @module plugins/eparagony/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import { useEffect, type ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
  errors?: Record<string, { type: string; message: string }>;
  enabledCapabilities?: string[];
}

function Harness({
  configIsParseable = true,
  syncStructuredToJson = vi.fn(),
  defaultValues = {},
  errors,
  enabledCapabilities,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      configText: '{}',
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
  // `setError` synchronously (well, on the next tick) puts real entries into
  // `formState.errors`, so the collapsed-group summaries can be asserted
  // against a real RHF error state rather than a hand-stubbed one. Done in an
  // effect, not during render, because `setError` schedules a state update.
  useEffect(() => {
    if (!errors) return;
    for (const [field, error] of Object.entries(errors)) {
      form.setError(field as never, error);
    }
    // Runs once per mount — `form` and `errors` are harness props that never
    // change identity across a single test, so an empty dependency array is
    // intentional rather than an omission.
  }, []);
  return (
    <EparagonyStructuredSection
      connection={
        enabledCapabilities === undefined
          ? eparagonyConnection
          : { ...eparagonyConnection, enabledCapabilities }
      }
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
    />
  );
}

/** Open a collapsed `<details>` group by its summary text. */
function openGroup(labelStart: string): void {
  const summary = screen.getByText(labelStart).closest('summary');
  if (!summary) throw new Error(`No disclosure summary matching ${labelStart}`);
  fireEvent.click(summary);
}

afterEach(cleanup);

describe('EparagonyStructuredSection', () => {
  it('should render the receipt fields without the operator opening anything', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Paper receipt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Payment form on the receipt')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment name')).toBeInTheDocument();
  });

  it('should state only the receipt-lane default on a connection with no Invoicing capability (#3192 review I3 / #3268 review I1)', () => {
    renderWithProviders(<Harness enabledCapabilities={[]} />);
    expect(screen.getByText(/Defaults to 60 s\. Values outside/)).toBeInTheDocument();
    expect(screen.queryByText(/45 s/)).not.toBeInTheDocument();
  });

  it('should state BOTH lane defaults once Invoicing is enabled on the connection (#3192 review I3 / #3268 review I1)', () => {
    renderWithProviders(<Harness enabledCapabilities={['Fiscalization', 'Invoicing']} />);
    expect(
      screen.getByText(/Defaults to 60 s for e-receipts, 45 s for e-invoices\./)
    ).toBeInTheDocument();
  });

  it('should wire the print radiogroup to its own description', () => {
    // `SegmentedControl` spreads onto a `<div role="radiogroup">`, which is not
    // a labelable element — so this group is deliberately NOT rendered through
    // `FormField` (whose `<label htmlFor>` would silently associate with
    // nothing). The name and description have to be asserted directly.
    renderWithProviders(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Paper receipt' });
    expect(group).toHaveAccessibleDescription(/produce a paper receipt/i);
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

  it('should summarise the fallback slot on the collapsed disclosure, naming what a set slot does', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('Not set — a line with no rate is refused')).toBeInTheDocument();

    cleanup();
    renderWithProviders(<Harness defaultValues={{ eparagonyDefaultTaxRateCode: 'B' }} />);
    // A bare "Slot B" is indistinguishable at a glance from the safe state; the
    // summary says what having one set actually means.
    expect(
      screen.getByText('Slot B — used when a line has no rate', {
        selector: '.inline-disclosure__value',
      }),
    ).toBeInTheDocument();
  });

  it('should name a problem count on a collapsed group so the operator knows which to open', async () => {
    // Five of eight fields sit in a `<details>` that starts closed, and
    // `FormErrorSummary` renders bare message strings with no field name and no
    // anchor — so without this the operator gets a message at the top of the
    // page and an apparently empty form below it.
    renderWithProviders(
      <Harness
        errors={{
          eparagonyApiBaseUrl: { type: 'custom', message: 'Must be a valid https:// URL.' },
          eparagonyAuthBaseUrl: { type: 'custom', message: 'Must be a valid https:// URL.' },
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 problems to fix/)).toBeInTheDocument();
    });
  });

  it('should explain the fallback hazard on demand, including that it can fire by default', () => {
    // The trigger lives inside a `<details>` that is closed by default. jsdom
    // does not implement content-hiding, so clicking without opening the group
    // would exercise something a real browser has collapsed.
    renderWithProviders(<Harness />);
    openGroup('Fallback tax rate:');
    fireEvent.click(
      screen.getByRole('button', { name: 'What the fallback tax rate does, and why it is risky' }),
    );
    expect(screen.getByText('Why setting it is risky')).toBeInTheDocument();
    expect(
      screen.getByText('On a standard installation it is off, so this fallback can fire.'),
    ).toBeInTheDocument();
  });

  it('should name the hazard popover, not just its trigger', () => {
    // Radix renders `role="dialog"` on the popover content; an unnamed dialog
    // is an axe `aria-dialog-name` failure.
    renderWithProviders(<Harness />);
    openGroup('Fallback tax rate:');
    fireEvent.click(
      screen.getByRole('button', { name: 'What the fallback tax rate does, and why it is risky' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'What the fallback tax rate does, and why it is risky' }),
    ).toBeInTheDocument();
  });

  it('should sync the diagnostic and testing fields under their own names', () => {
    const sync = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={sync} />);

    fireEvent.change(screen.getByLabelText('Fallback device slot'), { target: { value: 'B' } });
    expect(sync).toHaveBeenCalledWith('eparagonyDefaultTaxRateCode', 'B');

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
    // The infotip sits in the field's DESCRIPTION, not its label. `FormField`
    // renders the label as `<label htmlFor>`, and a control's accessible name is
    // computed from that label's subtree — so a button placed inside it would
    // fold its own `aria-label` into the select's name and leave the control
    // announced as "Fallback device slot What the fallback tax rate does, and
    // why it is risky". Asserted as the computed NAME rather than via
    // `getByLabelText`, which matches label text content and would pass either
    // way for the wrong reason.
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText('Fallback device slot')).toHaveAccessibleName(
      'Fallback device slot',
    );
  });

  it('should report a stored value outside the vocabulary rather than showing it as the default', () => {
    // Narrowing an unrecognised value to `''` makes the select render it as
    // "Use the default", which is a false statement about the operator's own
    // data — and the 400 they get on save names a key the form shows as unset.
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ paymentForm: 'Bitcoin' }) }} />,
    );
    expect(screen.getByText(/The saved value \(Bitcoin\) is not one eparagony\.pl accepts/)).toBeInTheDocument();
  });

  it('should simplify the payment-form warning copy now the recommended option genuinely fixes it (#3311)', () => {
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ paymentForm: 'Bitcoin' }) }} />,
    );
    expect(
      screen.getByText(
        'The saved value (Bitcoin) is not one eparagony.pl accepts, so saving this connection will be refused until you pick one below.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pick a different value below/)).not.toBeInTheDocument();
  });

  it('should point the payment-form select at the raw unrecognised value rather than "Use the default" (#3311)', () => {
    // Before the fix, an unrecognised stored value hydrated the FIELD — and
    // hence the controlled select — to '', the same value as "Use the
    // default", so the browser's real selected option was already the
    // recommended one and re-picking it fired no `onChange`. Asserting the
    // select's OWN value here is what proves the fix: the DOM's real
    // selection is the raw stored string, not the recommended option, so a
    // real browser sees a genuine change when the operator re-picks it.
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ paymentForm: 'Bitcoin' }) }} />,
    );
    expect(screen.getByLabelText('Payment form on the receipt')).toHaveValue('Bitcoin');
  });

  it('should fix an unrecognised payment-form value by re-selecting the already-shown recommended option (#3311)', () => {
    const sync = vi.fn();
    renderWithProviders(
      <Harness
        syncStructuredToJson={sync}
        defaultValues={{ configText: JSON.stringify({ paymentForm: 'Bitcoin' }) }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Payment form on the receipt'), {
      target: { value: '' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyPaymentForm', '');
  });

  it('should still sync a genuinely different payment-form choice while an unrecognised value is stored', () => {
    // No regression on the already-correct path: picking a real vendor value
    // works exactly as before.
    const sync = vi.fn();
    renderWithProviders(
      <Harness
        syncStructuredToJson={sync}
        defaultValues={{ configText: JSON.stringify({ paymentForm: 'Bitcoin' }) }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Payment form on the receipt'), {
      target: { value: 'Karta' },
    });
    expect(sync).toHaveBeenCalledWith('eparagonyPaymentForm', 'Karta');
  });

  it('should simplify the fallback-slot warning copy now the recommended option genuinely fixes it (#3311)', () => {
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ defaultTaxRateCode: 'Z' }) }} />,
    );
    openGroup('Fallback tax rate:');
    expect(
      screen.getByText(
        /The saved value \(Z\) is not a slot this fiscal device exposes, so saving this connection will be refused until you pick one below\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pick a different slot below/)).not.toBeInTheDocument();
  });

  it('should point the fallback-slot select at the raw unrecognised value rather than "Not set" (#3311)', () => {
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ defaultTaxRateCode: 'Z' }) }} />,
    );
    openGroup('Fallback tax rate:');
    expect(screen.getByLabelText('Fallback device slot')).toHaveValue('Z');
  });

  it('should fix an unrecognised fallback-slot value by re-selecting the already-shown "Not set" option (#3311)', () => {
    const sync = vi.fn();
    renderWithProviders(
      <Harness
        syncStructuredToJson={sync}
        defaultValues={{ configText: JSON.stringify({ defaultTaxRateCode: 'Z' }) }}
      />,
    );
    openGroup('Fallback tax rate:');
    fireEvent.change(screen.getByLabelText('Fallback device slot'), { target: { value: '' } });
    expect(sync).toHaveBeenCalledWith('eparagonyDefaultTaxRateCode', '');
  });

  it('should not warn about a cleared or absent value', () => {
    // `null` is the CLEARED state the apply path writes. Reporting it would put
    // a warning on every field an operator has deliberately emptied.
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ paymentForm: null }) }} />,
    );
    expect(screen.queryByText(/is not one eparagony\.pl accepts/)).not.toBeInTheDocument();
  });

  it('should report an unrecognised print value the same way as the two enum fields', () => {
    // `print` is the same hazard as `paymentForm` / `defaultTaxRateCode`: the
    // backend validator rejects a non-boolean `print` exactly like it rejects
    // an unrecognised enum value, so a hand-typed `"yes"` in the raw editor
    // deserves the identical warning rather than silently rendering as
    // "Not set" (#3268 review).
    renderWithProviders(
      <Harness defaultValues={{ configText: JSON.stringify({ print: 'yes' }) }} />,
    );
    expect(screen.getByText(/The saved value \(yes\) is not true or false/)).toBeInTheDocument();
  });

  it('should not warn about a cleared print value', () => {
    renderWithProviders(<Harness defaultValues={{ configText: JSON.stringify({ print: null }) }} />);
    expect(screen.queryByText(/is not true or false/)).not.toBeInTheDocument();
  });

  it('should not warn about an absent print value', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText(/is not true or false/)).not.toBeInTheDocument();
  });

  it('should not offer the tax rate slot table, but must say where it lives', () => {
    // Contributing a structured section put the raw-JSON editor behind a toggle
    // it was not behind before, and `taxRates` is the more dangerous of the two
    // keys: left unset the adapter assumes the standard Polish slots, so a
    // differently-programmed device registers real sales at the wrong rate.
    renderWithProviders(<Harness />);
    expect(screen.queryByLabelText(/slot a rate/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/tax rates/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Show raw config JSON/)).toBeInTheDocument();
  });
});
