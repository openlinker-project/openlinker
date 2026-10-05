/**
 * Change size on the label card (#3655)
 *
 * The load-bearing assertions: units convert to the wire's mm and grams, no
 * address/recipient/carrier field exists, every refusal has its own line and
 * leaves the old label, `cancelled-not-replaced` is a warning and never a
 * success (and an in-doubt void claims neither answer), a failure never claims
 * nothing was cancelled, a demo viewer sees the control locked rather than
 * hidden, and a double click sends one request.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { BenchLabelReplaceResult } from '../api/bench-parcel.types';
import { cmToMm, kgToGrams, toReplaceInput } from '../lib/bench-label-replace';
import { BenchDocumentsPanel } from './bench-documents';

const REPLACED: BenchLabelReplaceResult = {
  outcome: 'replaced',
  reason: null,
  voidState: 'confirmed',
  keptTemplate: null,
};

const refused = (reason: string): BenchLabelReplaceResult => ({
  outcome: 'refused',
  reason,
  voidState: null,
  keptTemplate: null,
});

const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: ['bench:write'],
  analyticsConsent: true,
} as const;

function mount(
  replace: (...args: never[]) => Promise<BenchLabelReplaceResult>,
  options: { templates?: string[]; permissions?: string[]; demoMode?: boolean } = {}
) {
  const replaceLabel = vi.fn(replace);
  const getDocuments = vi.fn().mockResolvedValue({
    workId: 'w-1',
    invoice: {
      state: 'ready',
      invoiceId: 'inv-1',
      documentNumber: 'FV/1',
      issuedAt: null,
      blockReason: null,
      unresolvedReason: null,
    },
    label: {
      state: 'ready',
      shipmentId: 'ol_shipment_1',
      carrier: 'InPost',
      trackingNumber: '620',
      providerCode: null,
      carrierMessage: null,
      failedAt: null,
      carrierMessageRedacted: false,
      parcelTemplates: options.templates ?? [],
    },
  });
  const apiClient = createMockApiClient({
    bench: {
      getDocuments,
      replaceLabel: replaceLabel as never,
      listUnlabelledParcels: vi.fn().mockResolvedValue({ parcels: [], total: 0, truncated: false }),
    },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: options.demoMode ?? false }) },
  });
  renderWithProviders(<BenchDocumentsPanel workId="w-1" unitsPacked={2} />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter({
      ...PACKER,
      permissions: (options.permissions ?? ['bench:write']) as never,
    }),
  });
  return { replaceLabel, getDocuments };
}

async function fillBox(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: /change size/i }));
  await user.type(screen.getByLabelText(/length \(cm\)/i), '30');
  await user.type(screen.getByLabelText(/width \(cm\)/i), '20');
  await user.type(screen.getByLabelText(/height \(cm\)/i), '10.5');
  await user.type(screen.getByLabelText(/weight \(kg\)/i), '1,25');
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /cancel it and buy a new label/i }));

describe('unit conversion (#3655)', () => {
  it('should convert cm to mm and kg to grams for a box', () => {
    expect(
      toReplaceInput({
        mode: 'box',
        template: '',
        lengthCm: '30',
        widthCm: '20',
        heightCm: '10.5',
        weightKg: '1,25',
      })
    ).toEqual({ lengthMm: 300, widthMm: 200, heightMm: 105, weightGrams: 1250 });
  });

  it('should send only the weight in weight-only mode and only the code for a template', () => {
    const base = { template: 'A', lengthCm: '', widthCm: '', heightCm: '', weightKg: '0.4' };
    expect(toReplaceInput({ ...base, mode: 'weight' })).toEqual({ weightGrams: 400 });
    expect(toReplaceInput({ ...base, mode: 'template' })).toEqual({ template: 'A' });
    expect(cmToMm(0.04)).toBe(0);
    expect(kgToGrams(0.0005)).toBe(1);
  });
});

describe('Change size (#3655)', () => {
  it('should hide the control from a session without bench:write', async () => {
    mount(() => Promise.resolve(REPLACED), { permissions: [] });
    expect(await screen.findByRole('button', { name: /print label/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change size/i })).toBeNull();
  });

  it('should offer parcel fields only and never an address, recipient or carrier', async () => {
    const user = userEvent.setup();
    mount(() => Promise.resolve(REPLACED));
    await user.click(await screen.findByRole('button', { name: /change size/i }));
    expect(screen.queryByLabelText(/address|recipient|street|name|carrier|email|phone/i)).toBeNull();
    expect(screen.getByText(/current label will be cancelled and a new one bought/i)).toBeInTheDocument();
  });

  it('should send mm and grams, refetch the documents and confirm on success', async () => {
    const user = userEvent.setup();
    const { replaceLabel, getDocuments } = mount(() => Promise.resolve(REPLACED));
    await fillBox(user);
    await submit(user);

    await waitFor(() => {
      expect(replaceLabel).toHaveBeenCalledWith('w-1', {
        lengthMm: 300,
        widthMm: 200,
        heightMm: 105,
        weightGrams: 1250,
      });
    });
    expect(await screen.findByTestId('bench-label-replaced')).toBeInTheDocument();
    await waitFor(() => {
      expect(getDocuments.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('should offer sizes when the carrier lists them and send the chosen code', async () => {
    const user = userEvent.setup();
    const { replaceLabel } = mount(() => Promise.resolve(REPLACED), {
      templates: ['A', 'B'],
    });
    await user.click(await screen.findByRole('button', { name: /change size/i }));
    await user.selectOptions(screen.getByLabelText(/^size$/i), 'B');
    await submit(user);
    await waitFor(() => {
      expect(replaceLabel).toHaveBeenCalledWith('w-1', { template: 'B' });
    });
  });

  it.each([
    ['cannot-cancel', /does not let us cancel/i],
    ['adapter-unresolved', /cannot reach the carrier connection right now/i],
    ['already-handed-over', /carrier already has this parcel/i],
    ['parcel-completed', /already marked done/i],
  ])('should explain the %s refusal in one line and keep the old label', async (reason, text) => {
    const user = userEvent.setup();
    const { getDocuments } = mount(() => Promise.resolve(refused(reason)));
    await fillBox(user);
    await submit(user);

    expect(await screen.findByTestId('bench-change-size-refusal')).toHaveTextContent(text);
    expect(screen.getByTestId('bench-change-size-refusal')).toHaveTextContent(/current label stays/i);
    expect(screen.queryByTestId('bench-label-void')).toBeNull();
    expect(screen.queryByTestId('bench-label-replaced')).toBeNull();
    expect(getDocuments).toHaveBeenCalledTimes(1);
  });

  it('should render cancelled-not-replaced as a warning, never as a success', async () => {
    const user = userEvent.setup();
    mount(() =>
      Promise.resolve({
        outcome: 'cancelled-not-replaced',
        reason: null,
        voidState: 'confirmed',
        keptTemplate: null,
      })
    );
    await fillBox(user);
    await submit(user);

    const warning = await screen.findByTestId('bench-label-void');
    expect(warning).toHaveTextContent(/old label is void/i);
    expect(warning).toHaveTextContent(/office/i);
    expect(screen.queryByTestId('bench-label-replaced')).toBeNull();
  });

  it('should say the old label may be void and not to use it when the void is in doubt', async () => {
    const user = userEvent.setup();
    mount(() =>
      Promise.resolve({
        outcome: 'cancelled-not-replaced',
        reason: null,
        voidState: 'in-doubt',
        keptTemplate: null,
      })
    );
    await fillBox(user);
    await submit(user);

    const warning = await screen.findByTestId('bench-label-void');
    expect(warning).toHaveTextContent(/may already be void/i);
    expect(warning).toHaveTextContent(/do not use it/i);
    expect(warning).not.toHaveTextContent(/the old label is void/i);
    // The row still reads live after an in-doubt void; the card must not offer it.
    expect(screen.queryByTestId('bench-documents-label')).toBeNull();
    expect(screen.queryByRole('button', { name: /print label/i })).toBeNull();
    expect(screen.queryByTestId('bench-label-replaced')).toBeNull();
  });

  it('should never claim nothing was cancelled when the request fails, and refetch the card', async () => {
    const user = userEvent.setup();
    const { getDocuments } = mount(() => Promise.reject(new Error('500')));
    await fillBox(user);
    await submit(user);

    expect(await screen.findByText(/did not go through/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing was cancelled/i)).toBeNull();
    await waitFor(() => {
      expect(getDocuments.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('should name the kept size when only the weight was corrected', async () => {
    const user = userEvent.setup();
    mount(() => Promise.resolve({ ...REPLACED, keptTemplate: 'small' }));
    await user.click(await screen.findByRole('button', { name: /change size/i }));
    await user.click(screen.getByRole('button', { name: /weight only/i }));
    await user.type(screen.getByLabelText(/weight \(kg\)/i), '2');
    await submit(user);

    expect(await screen.findByTestId('bench-label-replaced')).toHaveTextContent(/size small/i);
  });

  it('should show the control locked, not hidden, to a demo viewer without bench:write', async () => {
    mount(() => Promise.resolve(REPLACED), { permissions: [], demoMode: true });
    const button = await screen.findByRole('button', { name: /change size/i });
    expect(button).toBeDisabled();
  });

  it('should send one request when the confirm button is double-clicked', async () => {
    const user = userEvent.setup();
    let resolve: (value: BenchLabelReplaceResult) => void = () => undefined;
    const { replaceLabel } = mount(
      () =>
        new Promise<BenchLabelReplaceResult>((r) => {
          resolve = r;
        })
    );
    await fillBox(user);
    const button = screen.getByRole('button', { name: /cancel it and buy a new label/i });
    await user.dblClick(button);

    await waitFor(() => {
      expect(replaceLabel).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: /buying a new label/i })).toBeDisabled();
    resolve(REPLACED);
    await screen.findByTestId('bench-label-replaced');
    expect(replaceLabel).toHaveBeenCalledTimes(1);
  });

  it('should not send anything while a measurement is missing', async () => {
    const user = userEvent.setup();
    const { replaceLabel } = mount(() => Promise.resolve(REPLACED));
    await user.click(await screen.findByRole('button', { name: /change size/i }));
    await submit(user);
    expect((await screen.findAllByText(/enter a number above zero/i)).length).toBeGreaterThan(0);
    expect(replaceLabel).not.toHaveBeenCalled();
  });
});
