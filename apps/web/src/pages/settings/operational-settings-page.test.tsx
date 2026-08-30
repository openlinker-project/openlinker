/**
 * Sync Pacing Page — tests
 *
 * The page-level properties worth pinning are the ones an operator's safety
 * depends on: the provenance comes from the API rather than a client-side
 * comparison, the save button is inert until something moves, and a rejected
 * value lands beside the control that produced it rather than in one banner.
 *
 * The arithmetic is asserted on the pure model, not here.
 *
 * @module apps/web/src/pages/settings
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/api-error';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { OperationalSettingsPage } from './operational-settings-page';

const CATALOGUE_REASON = 'Past this the queue deepens rather than the read.';

function numeric(
  value: number,
  recommendedMax: number,
  absoluteMax: number,
  recommendedReason: string,
): Record<string, unknown> {
  return {
    value,
    source: 'default',
    recommendedMax,
    recommendedReason,
    absoluteMax,
    absoluteReason: 'A sanity backstop against a mistyped value.',
    aboveRecommended: value > recommendedMax,
  };
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogueSweepBudget: numeric(500, 2000, 20_000, CATALOGUE_REASON),
    inventorySweepBudget: numeric(100, 2000, 20_000, 'Headroom is the point.'),
    sweepPageSize: numeric(100, 100, 500, 'Ids are joined into a query string.'),
    deletionAuditBudget: numeric(100, 2000, 20_000, 'A 41.7-day cycle is what this is for.'),
    deletionAuditCadence: { value: '0 * * * *', source: 'default' },
    deletionAuditAlwaysEnabled: true,
    cadenceAppliesAt: 'next-scheduler-start',
    updatedAt: null,
    updatedBy: null,
    adapterClampNote: 'A page size above what an adapter can send is clamped when the request is built.',
    bounds: {
      catalogueSweepBudget: {
        min: 1,
        recommendedMax: 2000,
        absoluteMax: 20_000,
        default: 500,
        envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT',
      },
      inventorySweepBudget: {
        min: 1,
        recommendedMax: 2000,
        absoluteMax: 20_000,
        default: 100,
        envVar: 'OL_INVENTORY_SYNC_PAGE_LIMIT',
      },
      sweepPageSize: {
        min: 1,
        recommendedMax: 100,
        absoluteMax: 500,
        default: 100,
        envVar: 'OL_SWEEP_PAGE_SIZE',
      },
      deletionAuditBudget: {
        min: 1,
        recommendedMax: 2000,
        absoluteMax: 20_000,
        default: 100,
        envVar: 'OL_MASTER_PRODUCT_RECONCILE_PAGE_LIMIT',
      },
    },
    ...overrides,
  };
}

/**
 * The namespace shape, reached through the test factory rather than through
 * `app/api/api-client` — a page module may not import app modules, and the cast
 * is needed because `vi.fn()` widens to `Mock<Procedure | Constructable>`,
 * which is not assignable to a concrete call signature.
 */
type OperationalSettingsApi = ReturnType<typeof createMockApiClient>['operationalSettings'];

function renderPage(
  overrides: {
    get?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  } = {},
): void {
  const apiClient = createMockApiClient({
    // Cast for the same reason `createMockApiClient`'s own namespace defaults
    // do: `vi.fn()` widens to `Mock<Procedure | Constructable>`, which is not
    // assignable to a concrete call signature.
    operationalSettings: {
      get: overrides.get ?? vi.fn().mockResolvedValue(view()),
      update: overrides.update ?? vi.fn().mockResolvedValue(undefined),
    } as OperationalSettingsApi,
  });

  renderWithProviders(<OperationalSettingsPage />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
}

describe('OperationalSettingsPage', () => {
  it('should render each value with the provenance the API reported', async () => {
    renderPage({
      get: vi.fn().mockResolvedValue(
        view({ catalogueSweepBudget: { value: 2000, source: 'setting' } }),
      ),
    });

    expect(await screen.findByText('2000 (you set this)')).toBeInTheDocument();
    expect(screen.getAllByText('100 (default)').length).toBeGreaterThan(0);
  });

  it('should keep the save button inert until something changes', async () => {
    renderPage();

    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    expect(screen.getByText('No changes yet.')).toBeInTheDocument();
  });

  it('should open no modal while nothing has changed', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Save changes' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should mark a changed field and enable the save', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', {
      name: 'Products per shop request',
    });
    await user.clear(numberBox);
    await user.type(numberBox, '50');

    await waitFor(() => {
      expect(screen.getByText('changed from 100')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  // Every documented value — each default, each recommendation, each absolute
  // ceiling — must be reachable and must not be reported invalid. With the
  // granularity on the control's own `step` and `min=1`, the reachable set was
  // `1, 51, 101, …`, so 500 / 100 / 2000 / 20000 were all `stepMismatch` and a
  // drag produced values like 5001 (#2660 review).
  it('should accept a documented value in the number box without marking it invalid', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', {
      name: 'Products per catalogue run',
    });
    await user.clear(numberBox);
    await user.type(numberBox, '2000');

    await waitFor(() => {
      expect(screen.getByText('changed from 500')).toBeInTheDocument();
    });
    expect((numberBox as HTMLInputElement).checkValidity()).toBe(true);
  });

  it('should let the slider land on a documented value rather than on a min-anchored grid', async () => {
    renderPage();

    const slider = await screen.findByRole('slider', { name: 'Products per catalogue run' });
    // The native step must not carry the granularity, or the browser rounds
    // every drag onto `min + n·step` and the documented values are unreachable.
    expect(slider).toHaveAttribute('step', '1');
    expect((slider as HTMLInputElement).checkValidity()).toBe(true);
  });

  it('should put a rejected value beside its own control, not in one banner', async () => {
    const update = vi.fn().mockRejectedValue(
      new ApiError('Bad Request', 400, {
        message: ['catalogueSweepBudget must not be greater than 2000'],
      }),
    );
    const user = userEvent.setup();
    renderPage({ update });

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '900');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('catalogueSweepBudget must not be greater than 2000'),
    ).toBeInTheDocument();
  });

  it('should refuse a non-admin session', async () => {
    const apiClient = createMockApiClient();
    renderWithProviders(<OperationalSettingsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'user',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByText('Admin role required')).toBeInTheDocument();
  });

  it('should say nothing about timing until the cadence is actually changed', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Save changes' });
    expect(screen.queryByText('When this starts')).not.toBeInTheDocument();
  });

  it('should say when a cadence change lands, once it is changed', async () => {
    const user = userEvent.setup();
    renderPage();

    const cadence = await screen.findByLabelText(/How often it runs/);
    await user.selectOptions(cadence, '0 */4 * * *');

    expect(await screen.findByText('When this starts')).toBeInTheDocument();
    expect(
      screen.getByText(/picked up the next time OpenLinker's background service restarts/),
    ).toBeInTheDocument();
  });

  it('should let the slider reach past the recommendation, up to the absolute ceiling', () => {
    // Stopping the control at the recommendation would make the raised
    // ceiling unreachable, which is the point of having two.
    renderPage();

    return screen
      .findByRole('slider', { name: 'Products per catalogue run' })
      .then((slider) => {
        expect(slider).toHaveAttribute('max', '20000');
      });
  });

  it('should refuse to save a value past the recommendation until it is acknowledged', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '5000');

    expect(await screen.findByText(CATALOGUE_REASON)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });
  });

  it('should allow the save once the operator acknowledges the crossing', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '5000');

    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    });
  });

  it('should send the acknowledgement flag only after the operator ticked it', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage({ update });

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '5000');
    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        catalogueSweepBudget: 5000,
        acknowledgeAboveRecommended: true,
      });
    });
  });

  it('should not send the acknowledgement flag for a change inside the recommendation', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage({ update });

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '1500');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ catalogueSweepBudget: 1500 });
    });
  });

  it('should say in the modal which ceiling a change crossed', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '5000');
    await user.click(await screen.findByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(/Above the 2000 we suggest/)).toBeInTheDocument();
  });

  it('should read a value already above the recommendation back as a deliberate override', async () => {
    renderPage({
      get: vi.fn().mockResolvedValue(
        view({
          catalogueSweepBudget: {
            ...numeric(5000, 2000, 20_000, CATALOGUE_REASON),
            source: 'setting',
          },
        }),
      ),
    });

    expect(
      await screen.findByText('5000 (you set this, above our recommendation)'),
    ).toBeInTheDocument();
  });

  it('should render a working control when the API reported no ceilings', async () => {
    renderPage({
      get: vi.fn().mockResolvedValue(
        view({
          catalogueSweepBudget: { value: 500, source: 'default' },
          bounds: undefined,
        }),
      ),
    });

    const slider = await screen.findByRole('slider', { name: 'Products per catalogue run' });
    expect(slider).toBeInTheDocument();
    expect(Number(slider.getAttribute('max'))).toBeGreaterThan(500);
  });

  it("should render the API's own note about adapter clamping", async () => {
    renderPage();

    expect(
      await screen.findByText(/clamped when the request is built/),
    ).toBeInTheDocument();
  });
});
