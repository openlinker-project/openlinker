/**
 * ShipmentLifecycleRail — component tests (#1425)
 *
 * Covers the stage sequence, the current-node mapping per status, and the
 * interrupted (failed / cancelled) variants.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';

import { ShipmentLifecycleRail } from './shipment-lifecycle-rail';
import type { ShipmentStatus } from '../../shipments';

afterEach(cleanup);

describe('ShipmentLifecycleRail', () => {
  it('should render four lifecycle stages', () => {
    render(<ShipmentLifecycleRail status="generated" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Label ready')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('should mark the dispatch stage current for a dispatched shipment', () => {
    render(<ShipmentLifecycleRail status="dispatched" />);
    const steps = screen.getAllByRole('listitem');
    expect(steps[0]).toHaveClass('shipment-lifecycle-rail__step--done');
    expect(steps[1]).toHaveClass('shipment-lifecycle-rail__step--current');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveClass('shipment-lifecycle-rail__step--live');
  });

  it('should mark the delivered stage as both current and done, and not live', () => {
    render(<ShipmentLifecycleRail status="delivered" />);
    const steps = screen.getAllByRole('listitem');
    expect(steps[3]).toHaveClass('shipment-lifecycle-rail__step--current');
    expect(steps[3]).toHaveClass('shipment-lifecycle-rail__step--done');
    expect(steps[3]).not.toHaveClass('shipment-lifecycle-rail__step--live');
  });

  it('should render the interrupted (halted) variant for a failed shipment', () => {
    const { container } = render(<ShipmentLifecycleRail status="failed" />);
    expect(container.querySelector('.shipment-lifecycle-rail--halted')).not.toBeNull();
    expect(screen.getByText('Dispatch failed')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem');
    expect(steps[1]).toHaveClass('shipment-lifecycle-rail__step--halt');
  });

  it('should render the cancelled variant with a muted halt node', () => {
    const { container } = render(<ShipmentLifecycleRail status="cancelled" />);
    expect(container.querySelector('.shipment-lifecycle-rail--cancelled')).not.toBeNull();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem');
    expect(steps[1]).toHaveClass('shipment-lifecycle-rail__step--halt');
  });

  it('should handle every shipment status without throwing', () => {
    const statuses: ShipmentStatus[] = [
      'draft',
      'generated',
      'dispatched',
      'in-transit',
      'delivered',
      'failed',
      'cancelled',
    ];
    for (const status of statuses) {
      const { unmount } = render(<ShipmentLifecycleRail status={status} />);
      expect(screen.getAllByRole('listitem')).toHaveLength(4);
      unmount();
    }
  });
});
