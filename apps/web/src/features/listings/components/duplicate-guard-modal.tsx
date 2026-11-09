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
 *   - marketplace: the backend *skips* already-listed variants rather than
 *     duplicating them (#1741's authoritative guard) - the copy here must
 *     match that (#1933; it previously promised a duplicate that was never
 *     created).
 *   - shop: publishing *updates the existing product* (upsert).
 *
 * A thin wrapper over `ConfirmDialog`; accepts the nested-dialog class hooks so
 * it can open elevated over the picker modal.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';

import {
  renderRich,
  selectPluralForm,
  useActiveLocale,
  useFormat,
  useMessages,
  usePlural,
} from '../../../shared/i18n';
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
  const copy = useMessages('listings').duplicateGuardModal;
  const plural = usePlural();
  const locale = useActiveLocale();
  const format = useFormat();
  const title = plural(duplicateCount, copy.title, { destination: destinationName });
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const params = { n: format.number(duplicateCount), destination: destinationName };

  const description = renderRich(
    selectPluralForm(
      duplicateCount,
      kind === 'shop' ? copy.descriptionShop : copy.descriptionMarketplace,
      locale,
    ),
    strong,
    params,
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      cancelLabel={copy.cancel}
      confirmLabel={kind === 'shop' ? copy.confirmShop : copy.confirmMarketplace}
      isConfirming={isConfirming}
      onConfirm={onConfirm}
      className={className}
      overlayClassName={overlayClassName}
    />
  );
}
