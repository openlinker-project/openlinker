/**
 * Processor Badge (#839)
 *
 * Renders the FE-derived processor kind for a shipment row — the visible
 * differentiator between branch-1 (OMP-fulfilled, projection-only),
 * branches 2/3 (carrier-issued), and the transient pre-dispatch state.
 *
 * Mirrors `ShipmentStatusBadge` in shape. Tones picked for status-meaning
 * alignment (none reuses an existing status tone for decoration):
 *   - `omp`     → `review` (purple — distinguishes from carrier-issued
 *                rows visually; PS-projected, no OL-side dispatch action)
 *   - `carrier` → `info`   (blue — provider id present, in-flight)
 *   - `pending` → `neutral` (no provider id yet — pre-dispatch)
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';

import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import {
  PROCESSOR_KIND_LABEL,
  type ProcessorKind,
} from '../lib/processor';

const TONE: Record<ProcessorKind, StatusBadgeTone> = {
  omp: 'review',
  carrier: 'info',
  pending: 'neutral',
};

interface ProcessorBadgeProps {
  processor: ProcessorKind;
}

export function ProcessorBadge({ processor }: ProcessorBadgeProps): ReactElement {
  return (
    <StatusBadge tone={TONE[processor]} withDot compact>
      {PROCESSOR_KIND_LABEL[processor]}
    </StatusBadge>
  );
}
