/**
 * AutomaticLabelsSection - component spec (#2729)
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AutomaticLabelsSection } from './automatic-labels-section';

const CONNECTION_ID = 'conn-oms';
const HOLDER = {
  connectionId: CONNECTION_ID,
  name: 'OpenLinker OMS',
  platformType: 'openlinker',
  holdsWork: true,
  autoDispatchEnabled: false,
};

function connection(config: Record<string, unknown>) {
  return {
    id: CONNECTION_ID,
    name: 'OpenLinker OMS',
    platformType: 'openlinker',
    status: 'active',
    config,
    enabledCapabilities: ['FulfillmentExecutor'],
    credentialsBacked: false,
  };
}

function setup(options: {
  config?: Record<string, unknown>;
  canWrite?: boolean;
  refusals?: unknown;
  preview?: unknown;
}) {
  const getById = vi.fn().mockResolvedValue(connection(options.config ?? {}));
  const update = vi.fn().mockResolvedValue(connection({}));
  const getRefusals = vi
    .fn()
    .mockResolvedValue(
      options.refusals === undefined
        ? { holder: HOLDER, needsInput: [], retrying: [] }
        : options.refusals
    );
  const preview = vi
    .fn()
    .mockResolvedValue(options.preview === undefined ? { holder: HOLDER, items: [] } : options.preview);
  const apiClient = createMockApiClient({
    connections: { getById, update },
    autoDispatch: { getRefusals, preview },
  });

  renderWithProviders(
    <AutomaticLabelsSection
      connectionId={CONNECTION_ID}
      canWrite={options.canWrite ?? true}
      writeVisible
      demoReadOnly={false}
    />,
    { apiClient }
  );
  return { getById, update, getRefusals, preview };
}

describe('AutomaticLabelsSection', () => {
  it('should show the stored settings once the connection loads', async () => {
    setup({
      config: {
        autoDispatch: { enabled: true, trigger: 'on-parcel-closed', defaultWeightGrams: 300 },
      },
    });

    expect(await screen.findByLabelText('Buy labels automatically')).toBeChecked();
    expect(screen.getByLabelText(/When the parcel is closed at the bench/)).toBeChecked();
    expect(screen.getByLabelText(/Fallback weight per unit/)).toHaveValue('300');
  });

  it('should explain what an empty fallback weight means, not block the save', async () => {
    setup({ config: {} });

    expect(await screen.findByTestId('auto-dispatch-weight-note')).toHaveTextContent(
      'refused, not guessed'
    );
  });

  it('should save only the autoDispatch key, on a config read at the moment of saving', async () => {
    const { getById, update } = setup({
      config: { sourcingAuthority: { enabled: true }, baseUrl: 'x' },
    });
    // The page loaded one config; by save time another tab has added a key.
    await screen.findByLabelText('Buy labels automatically');
    getById.mockResolvedValue(
      connection({ sourcingAuthority: { enabled: true }, baseUrl: 'x', addedElsewhere: true })
    );

    fireEvent.click(screen.getByLabelText('Buy labels automatically'));
    fireEvent.change(screen.getByLabelText(/Fallback weight per unit/), { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('btn-auto-dispatch-save'));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(CONNECTION_ID, {
      config: {
        sourcingAuthority: { enabled: true },
        baseUrl: 'x',
        addedElsewhere: true,
        autoDispatch: { enabled: true, trigger: 'on-accept', defaultWeightGrams: 300 },
      },
    });
  });

  it('should refuse a half-filled box and a non-positive weight beside the field, saving nothing', async () => {
    const { update } = setup({ config: {} });
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.change(screen.getByLabelText(/Fallback weight per unit/), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('btn-auto-dispatch-save'));

    expect(await screen.findByText('Weight must be a number greater than 0')).toBeInTheDocument();
    expect(screen.getByText(/Set length, width and height together/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('should show the API error when the save is refused', async () => {
    const { update } = setup({ config: {} });
    update.mockRejectedValue(new Error('config.autoDispatch.trigger must be one of'));
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.click(screen.getByLabelText('Buy labels automatically'));
    fireEvent.click(screen.getByTestId('btn-auto-dispatch-save'));

    expect(await screen.findByText(/trigger must be one of/)).toBeInTheDocument();
  });

  it('should preview the DRAFT values, not the saved ones, and report the verdict per order', async () => {
    const { preview } = setup({
      config: {},
      preview: {
        holder: HOLDER,
        items: [
          {
            workId: 'w1',
            orderId: 'ol_order_1',
            weightGrams: 750,
            template: 'small',
            dimensions: null,
            refusal: null,
          },
          {
            workId: 'w2',
            orderId: 'ol_order_2',
            weightGrams: null,
            template: null,
            dimensions: null,
            refusal: 'no-weight',
          },
        ],
      },
    });
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.change(screen.getByLabelText(/Fallback weight per unit/), { target: { value: '250' } });
    fireEvent.click(screen.getByTestId('btn-auto-dispatch-preview'));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview).toHaveBeenCalledWith(CONNECTION_ID, { defaultWeightGrams: 250, limit: 10 });
    expect(await screen.findByTestId('auto-dispatch-preview-summary')).toHaveTextContent(
      '1 would get a label, 1 would be refused.'
    );
    expect(screen.getAllByTestId('auto-dispatch-preview-row')).toHaveLength(2);
    expect(screen.getByText('No weight on the product and no fallback weight')).toBeInTheDocument();
  });

  it('should not preview a draft that cannot be saved', async () => {
    const { preview } = setup({ config: {} });
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.change(screen.getByLabelText(/Fallback weight per unit/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('btn-auto-dispatch-preview'));

    expect(await screen.findByText('Weight must be a number greater than 0')).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it('should report an unreadable preview, never an empty one', async () => {
    setup({ config: {}, preview: null });
    await screen.findByLabelText('Buy labels automatically');

    fireEvent.click(screen.getByTestId('btn-auto-dispatch-preview'));

    expect(await screen.findByText(/shape this version cannot read/)).toBeInTheDocument();
  });

  it('should split refusals into needs-your-input and retrying, with a reason the operator can act on', async () => {
    setup({
      config: {},
      refusals: {
        holder: HOLDER,
        needsInput: [
          {
            jobId: 'j1',
            workId: 'w1',
            orderId: 'ol_order_1',
            code: 'no-weight',
            bucket: 'needs-input',
            since: '2026-10-22T10:00:00Z',
            attempts: 1,
            maxAttempts: 10,
          },
        ],
        retrying: [
          {
            jobId: 'j2',
            workId: 'w2',
            orderId: 'ol_order_2',
            code: 'carrier-refused',
            bucket: 'retrying',
            since: '2026-10-22T10:05:00Z',
            attempts: 2,
            maxAttempts: 10,
          },
        ],
      },
    });

    const needsInput = await screen.findByTestId('auto-dispatch-needs-input');
    expect(needsInput).toHaveTextContent('Set one above');
    expect(screen.getByTestId('auto-dispatch-retrying')).toHaveTextContent('Attempt 2 of 10');
  });

  it('should say there are no refusals only when the read really returned none', async () => {
    setup({ config: {} });
    expect(await screen.findByTestId('auto-dispatch-refusals-empty')).toBeInTheDocument();
  });

  it('should report an unreadable refusal list instead of saying there are none', async () => {
    setup({ config: {}, refusals: null });

    expect(await screen.findByText(/shape this version cannot read/)).toBeInTheDocument();
    expect(screen.queryByTestId('auto-dispatch-refusals-empty')).not.toBeInTheDocument();
  });

  it('should disable the inputs and offer no Save to a role that cannot write, yet still preview', async () => {
    const { preview } = setup({ config: { autoDispatch: { enabled: true } }, canWrite: false });

    expect(await screen.findByLabelText('Buy labels automatically')).toBeDisabled();
    expect(screen.getByTestId('btn-auto-dispatch-save')).toBeDisabled();
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-auto-dispatch-preview'));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  });

  it('should report a connection that cannot be read, with a retry', async () => {
    const apiClient = createMockApiClient({
      connections: { getById: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    renderWithProviders(
      <AutomaticLabelsSection connectionId={CONNECTION_ID} canWrite writeVisible demoReadOnly={false} />,
      { apiClient }
    );

    expect(await screen.findByText('Could not read the current settings')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});
