/**
 * StepProductMaster — component spec (#3457)
 *
 * Exercises the four conditions that decide whether the operator may proceed
 * (no master, more than two, an override pointing elsewhere, an inactive MAIN)
 * plus the happy path, the failure states and the read-only gates, through the
 * rendered step rather than through the pure selectors.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { InventoryLocation } from '../../inventory';
import { StepProductMaster, type StepProductMasterProps } from '../components/step-product-master';
import { OmsSetupError } from '../lib/oms-setup-error';

function master(id: string, name: string): Connection {
  return {
    ...sampleConnection,
    id,
    name,
    status: 'active',
    supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
    enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
  };
}

function location(status: InventoryLocation['status']): InventoryLocation {
  return {
    id: 'loc-1',
    code: 'MAIN',
    name: 'Main warehouse',
    kind: 'warehouse',
    ownerConnectionId: null,
    externalRef: null,
    status,
    countryIso2: null,
    postcode: null,
    latitude: null,
    longitude: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as InventoryLocation;
}

function baseProps(overrides: Partial<StepProductMasterProps> = {}): StepProductMasterProps {
  return {
    masters: [master('c1', 'My shop')],
    partial: [],
    conflicting: [],
    mainLocation: null,
    done: false,
    progress: { located: 0, total: 0, complete: false, isLoading: false },
    masterNames: 'My shop',
    canWrite: true,
    demoReadOnly: false,
    confirming: false,
    confirmError: null,
    onConfirm: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };
}

const confirmButton = (): HTMLElement => screen.getByTestId('btn-confirm-product-master');

describe('StepProductMaster', () => {
  it('should show the connect-first state and no confirm button with zero masters', () => {
    renderWithProviders(<StepProductMaster {...baseProps({ masters: [] })} />);

    expect(screen.getByTestId('alert-no-product-master')).toBeInTheDocument();
    expect(screen.getByTestId('link-connect-product-master')).toHaveAttribute(
      'href',
      '/connections/new',
    );
    expect(screen.queryByTestId('btn-confirm-product-master')).not.toBeInTheDocument();
  });

  it('should say which capability a half-qualified connection is missing', () => {
    const half = { ...master('c9', 'Half shop'), enabledCapabilities: ['ProductMaster'] };
    renderWithProviders(
      <StepProductMaster
        {...baseProps({
          masters: [],
          partial: [{ connection: half, missing: ['InventoryMaster'] }],
        })}
      />,
    );

    expect(screen.getByTestId('alert-partial-product-master')).toHaveTextContent('Half shop');
  });

  it('should enable Confirm for exactly one master and call onConfirm', () => {
    const onConfirm = vi.fn();
    renderWithProviders(<StepProductMaster {...baseProps({ onConfirm })} />);

    expect(screen.getAllByTestId('product-master-card')).toHaveLength(1);
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should allow two masters but warn that they feed one warehouse', () => {
    renderWithProviders(
      <StepProductMaster
        {...baseProps({ masters: [master('c1', 'Shop A'), master('c2', 'Shop B')] })}
      />,
    );

    expect(screen.getByTestId('alert-two-product-masters')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('should block Confirm with more than two masters', () => {
    renderWithProviders(
      <StepProductMaster
        {...baseProps({
          masters: [master('c1', 'A'), master('c2', 'B'), master('c3', 'C')],
        })}
      />,
    );

    expect(screen.getByTestId('alert-too-many-product-masters')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('should block Confirm when a stock-location override points somewhere else', () => {
    renderWithProviders(
      <StepProductMaster {...baseProps({ conflicting: [master('c1', 'My shop')] })} />,
    );

    expect(screen.getByTestId('alert-stock-location-conflict')).toHaveTextContent('My shop');
    expect(confirmButton()).toBeDisabled();
  });

  it('should block Confirm when the main warehouse is inactive', () => {
    renderWithProviders(
      <StepProductMaster {...baseProps({ mainLocation: location('inactive') })} />,
    );

    expect(screen.getByTestId('alert-main-location-inactive')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('should not block on an active main warehouse', () => {
    renderWithProviders(
      <StepProductMaster {...baseProps({ mainLocation: location('active') })} />,
    );

    expect(confirmButton()).toBeEnabled();
  });

  it('should disable Confirm while confirming', () => {
    renderWithProviders(<StepProductMaster {...baseProps({ confirming: true })} />);

    expect(confirmButton()).toBeDisabled();
  });

  it('should disable Confirm and explain for a non-admin', () => {
    renderWithProviders(<StepProductMaster {...baseProps({ canWrite: false })} />);

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('Only an admin can change the packing setup.')).toBeInTheDocument();
  });

  it('should name the step that failed when Confirm errors', () => {
    renderWithProviders(
      <StepProductMaster
        {...baseProps({ confirmError: new OmsSetupError('location', new Error('boom')) })}
      />,
    );

    const alert = screen.getByTestId('alert-setup-failed');
    expect(within(alert).getByText(/warehouse|location/i)).toBeInTheDocument();
  });

  it('should show stock-location progress and Continue once confirmed', () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <StepProductMaster
        {...baseProps({
          done: true,
          progress: { located: 40, total: 100, complete: false, isLoading: false },
          onContinue,
        })}
      />,
    );

    const progress = screen.getByTestId('stock-located-progress');
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    fireEvent.click(screen.getByTestId('btn-continue-step-1'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
