/**
 * DuplicateGuardModal (#1837)
 *
 * Destination-aware soft confirm shown when the operator is about to publish
 * variants that are already listed on the chosen destination. It NEVER blocks -
 * re-publishing (marketplace) or updating (shop) is a valid operator choice; it
 * just makes the consequence explicit before the action commits.
 *
 * The wording + primary action are driven by the destination KIND (resolved
 * from the connection's capabilities upstream, never a platformType literal):
 *   - marketplace: publishing creates a *duplicate offer*.
 *   - shop: publishing *updates the existing product* (upsert).
 *
 * A thin wrapper over `ConfirmDialog`; accepts the nested-dialog class hooks so
 * it can open elevated over the picker modal.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';

import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import type { PublishDestinationKind } from '../lib/publish-destinations';

interface DuplicateGuardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PublishDestinationKind;
  destinationName: string;
  /** How many selected/included variants are already published there. */
  duplicateCount: number;
  isConfirming?: boolean;
  onConfirm: () => void;
  /** Elevated class when opened over another dialog (e.g. the picker). */
  className?: string;
  overlayClassName?: string;
}

function variantNoun(count: number): string {
  return count === 1 ? 'variant' : 'variants';
}

export function DuplicateGuardModal({
  open,
  onOpenChange,
  kind,
  destinationName,
  duplicateCount,
  isConfirming = false,
  onConfirm,
  className,
  overlayClassName,
}: DuplicateGuardModalProps): ReactElement {
  const title = `${duplicateCount} ${variantNoun(duplicateCount)} already on ${destinationName}`;

  const description =
    kind === 'shop' ? (
      <>
        <strong>{duplicateCount}</strong> {variantNoun(duplicateCount)} you selected already exist on{' '}
        <strong>{destinationName}</strong>. Publishing <strong>updates the existing product</strong>{' '}
        (upsert) rather than creating a new one. Continue?
      </>
    ) : (
      <>
        <strong>{duplicateCount}</strong> {variantNoun(duplicateCount)} you selected already have an
        offer on <strong>{destinationName}</strong>. Publishing again{' '}
        <strong>creates a duplicate offer</strong> - the existing one is not replaced. Continue?
      </>
    );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      cancelLabel="Go back"
      confirmLabel={kind === 'shop' ? 'Update existing' : 'Publish anyway (creates duplicate)'}
      isConfirming={isConfirming}
      onConfirm={onConfirm}
      className={className}
      overlayClassName={overlayClassName}
    />
  );
}
