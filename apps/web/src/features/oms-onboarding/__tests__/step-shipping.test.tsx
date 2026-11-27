/**
 * StepShipping - component spec (#3958)
 *
 * Part 2 is locked until a delivery method has a route that buys a label; "No"
 * is preselected and writes nothing; "Yes" saves `config.autoDispatch` in
 * wire units; a partial box or a missing weight cannot be saved; Continue
 * asks before discarding unsaved routing.
 */
import { fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import mappingsEn from '../../../locales/en/mappings.json';

const PARCEL_COPY = mappingsEn.parcelProfile;
import type * as MappingsModule from '../../mappings';
import { StepShipping, type StepShippingProps } from '../components/step-shipping';
import { shippingStepCopyIn } from '../hooks/use-shipping-setup-copy';

// The step renders in English under test, so its sentences are read from the
// English locale rather than restated here.
const STEP = shippingStepCopyIn('en');

// The routing editor is the mappings feature's own and is specified there; here
// it only needs to report that it holds an unsaved change.
vi.mock('../../mappings', async (importOriginal): Promise<typeof MappingsModule> => ({
  ...(await importOriginal<typeof MappingsModule>()),
  FulfillmentRoutingSection: ({
    sourceConnectionId,
    onDirtyChange,
  }: {
    sourceConnectionId: string;
    onDirtyChange?: (dirty: boolean) => void;
  }): ReactElement => (
    <button type="button" data-testid={`routing-${sourceConnectionId}`} onClick={() => onDirtyChange?.(true)}>
      edit routing
    </button>
  ),
}));

function source(id: string, name: string): Connection {
  return {
    id,
    name,
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: ['OrderSource'],
    supportedCapabilities: ['OrderSource'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ALLEGRO = source('src-allegro', 'Allegro');

function baseProps(overrides: Partial<StepShippingProps> = {}): StepShippingProps {
  return {
    sources: [ALLEGRO],
    hasCarrier: true,
    coverage: { [ALLEGRO.id]: { status: 'ready', withCarrier: 2, total: 5 } },
    saved: null,
    canWrite: true,
    demoReadOnly: false,
    saving: false,
    saveError: null,
    onBack: vi.fn(),
    onContinue: vi.fn(),
    onSave: vi.fn(),
    onTurnOff: vi.fn(),
    ...overrides,
  };
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('StepShipping', () => {
  it('should lock part 2 with "No" selected while no delivery method buys a label', () => {
    renderWithProviders(
      <StepShipping {...baseProps({ coverage: { [ALLEGRO.id]: { status: 'ready', withCarrier: 0, total: 5 } } })} />
    );

    expect(screen.getByTestId('shipping-part-2')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByTestId('radio-auto-dispatch-no')).toBeChecked();
    expect(screen.getByTestId('radio-auto-dispatch-yes')).toBeDisabled();
    expect(screen.getByText(STEP.autoLocked)).toBeInTheDocument();
  });

  it('should stay locked when no carrier is connected, and link to connecting one', () => {
    renderWithProviders(<StepShipping {...baseProps({ hasCarrier: false })} />);

    expect(screen.getByTestId('shipping-part-2')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByRole('link', { name: STEP.connectCarrier })).toHaveAttribute(
      'href',
      '/connections/new?from=oms-setup'
    );
  });

  it('should write nothing when the operator continues with "No"', () => {
    const onSave = vi.fn();
    const onTurnOff = vi.fn();
    const onContinue = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onSave, onTurnOff, onContinue })} />);

    expect(screen.getByTestId('radio-auto-dispatch-no')).toBeChecked();
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onTurnOff).not.toHaveBeenCalled();
  });

  it('should save the defaults in grams and millimetres when the operator says yes', () => {
    const onSave = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onSave })} />);

    fireEvent.click(screen.getByTestId('radio-auto-dispatch-yes'));
    fireEvent.change(screen.getByLabelText(PARCEL_COPY.templateLabel), { target: { value: 'medium' } });
    type(PARCEL_COPY.lengthLabel, '30');
    type(PARCEL_COPY.widthLabel, '20');
    type(PARCEL_COPY.heightLabel, '10');
    type(PARCEL_COPY.weightLabel, '0.5');
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));

    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      parcelTemplate: 'medium',
      defaultWeightGrams: 500,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
    });
  });

  it('should refuse a partial box', () => {
    const onSave = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onSave })} />);

    fireEvent.click(screen.getByTestId('radio-auto-dispatch-yes'));
    type(PARCEL_COPY.lengthLabel, '30');
    type(PARCEL_COPY.widthLabel, '20');
    type(PARCEL_COPY.weightLabel, '0.5');
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('shipping-defaults-error')).toHaveTextContent(PARCEL_COPY.boxIncomplete);
  });

  it('should refuse a missing or non-positive weight', () => {
    const onSave = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onSave })} />);

    fireEvent.click(screen.getByTestId('radio-auto-dispatch-yes'));
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));
    expect(screen.getByTestId('shipping-defaults-error')).toHaveTextContent(STEP.weightRequired);

    type(PARCEL_COPY.weightLabel, '0');
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));
    expect(screen.getByTestId('shipping-defaults-error')).toHaveTextContent(PARCEL_COPY.notPositive);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('should switch a saved "yes" off when the operator now answers no', () => {
    const onTurnOff = vi.fn();
    const onContinue = vi.fn();
    renderWithProviders(
      <StepShipping
        {...baseProps({ onTurnOff, onContinue, saved: { enabled: true, defaultWeightGrams: 500 } })}
      />
    );

    expect(screen.getByTestId('radio-auto-dispatch-yes')).toBeChecked();
    fireEvent.click(screen.getByTestId('radio-auto-dispatch-no'));
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));

    expect(onTurnOff).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('should show a source that cannot list its delivery methods without an expander', () => {
    const presta = source('src-presta', 'My shop');
    renderWithProviders(
      <StepShipping
        {...baseProps({
          sources: [ALLEGRO, presta],
          coverage: {
            [ALLEGRO.id]: { status: 'ready', withCarrier: 2, total: 5 },
            [presta.id]: { status: 'cannot-list', withCarrier: 0, total: 0 },
          },
        })}
      />
    );

    expect(screen.getByTestId(`shipping-source-${presta.id}`)).toHaveTextContent(STEP.cannotList);
    expect(screen.queryByTestId(`btn-shipping-source-${presta.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`btn-shipping-source-${ALLEGRO.id}`)).toBeInTheDocument();
  });

  it('should say a failed read failed, and offer a retry, instead of claiming the source has no methods', () => {
    renderWithProviders(
      <StepShipping
        {...baseProps({
          sources: [ALLEGRO],
          coverage: { [ALLEGRO.id]: { status: 'load-failed', withCarrier: 0, total: 0 } },
        })}
      />
    );

    const row = screen.getByTestId(`shipping-source-${ALLEGRO.id}`);
    expect(row).toHaveTextContent(STEP.loadFailed);
    expect(row).not.toHaveTextContent(STEP.cannotList);
    expect(screen.getByTestId(`btn-shipping-source-retry-${ALLEGRO.id}`)).toBeInTheDocument();
  });

  it('should show the coverage and its badge for a source', () => {
    renderWithProviders(<StepShipping {...baseProps()} />);

    const row = screen.getByTestId(`shipping-source-${ALLEGRO.id}`);
    expect(row).toHaveTextContent(STEP.coverage(2, 5));
    expect(row).toHaveTextContent(STEP.badge.partly);
  });

  it('should ask before discarding unsaved routing, and continue only when told to', () => {
    const onContinue = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onContinue })} />);

    fireEvent.click(screen.getByTestId(`btn-shipping-source-${ALLEGRO.id}`));
    fireEvent.click(screen.getByTestId(`routing-${ALLEGRO.id}`));
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));

    expect(screen.getByText(STEP.unsavedTitle('Allegro'))).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: STEP.continueWithoutSaving }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('should go back to the open editor from the unsaved-routing question', () => {
    const onContinue = vi.fn();
    renderWithProviders(<StepShipping {...baseProps({ onContinue })} />);

    fireEvent.click(screen.getByTestId(`btn-shipping-source-${ALLEGRO.id}`));
    fireEvent.click(screen.getByTestId(`routing-${ALLEGRO.id}`));
    fireEvent.click(screen.getByTestId('btn-continue-shipping'));
    fireEvent.click(screen.getByRole('button', { name: STEP.goBackAndSave }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId(`btn-shipping-source-${ALLEGRO.id}`)).toHaveAttribute('aria-expanded', 'true');
  });
});
