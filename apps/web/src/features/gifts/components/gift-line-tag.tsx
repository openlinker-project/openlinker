/**
 * GiftLineTag (#3940, mockup M31 `order-gift-tag-*`)
 *
 * A gift is shown once, in its own line, with a small tag. The tag's popover
 * answers the three questions an operator asks of it: who decided it, who pays,
 * and how the sales document will show it (and where that choice came from).
 * There is no separate "gifts" section.
 *
 * The document form resolves through the three levels (the gift itself, then the
 * connection that issues the document, then the OpenLinker default). The
 * connection is known only once a document exists for the order, so before that
 * a gift without its own form reads "OpenLinker default" rather than a guess.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useConnectionsQuery } from '../../connections';
import {
  readGiftConnectionOverride,
  resolveGiftDocumentForm,
  useGiftDocumentSettingsQuery,
  useGiftFormLabels,
} from '../../gift-documents';
import { giftSourceKey, type LineGift } from '../lib/gift-line';

export interface GiftLineTagProps {
  /** A key for test ids: the line's SKU, or its id. */
  lineKey: string;
  gift: LineGift;
  currency?: string;
  /** What the gift costs the seller, net, for all units; `null` when not recorded; read only when `costState` is `ready`. */
  costNet?: number | null;
  /**
   * Where the cost read stands. `unavailable` (absent) means this role or
   * setting does not read costs, which says nothing about whether one is on file.
   */
  costState?: 'loading' | 'failed' | 'unavailable' | 'ready';
  /** The connection issuing the sales document, once there is one. */
  documentConnectionId?: string | null;
}

export function GiftLineTag({
  lineKey,
  gift,
  currency,
  costNet,
  costState = costNet === undefined ? 'unavailable' : 'ready',
  documentConnectionId = null,
}: GiftLineTagProps): ReactElement {
  const copy = useMessages('gifts');
  const labels = useGiftFormLabels();
  const settings = useGiftDocumentSettingsQuery();
  const connections = useConnectionsQuery(undefined, { enabled: documentConnectionId !== null });
  const connection = connections.data?.find((c) => c.id === documentConnectionId);
  const resolved = resolveGiftDocumentForm(
    gift.documentForm,
    readGiftConnectionOverride(connection?.config),
    settings.data?.giftDocumentForm,
  );
  const sourceCopy = copy.order.source[giftSourceKey(gift.source)];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="gift-tag"
          aria-label={copy.order.tagLabel}
          data-testid={`order-gift-tag-${lineKey}`}
        >
          <StatusBadge tone="info" compact>
            {copy.order.tag}
          </StatusBadge>
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid={`order-gift-tag-${lineKey}-popover`}>
        <dl className="gift-tag__facts">
          <div>
            <dt>{copy.order.decidedBy}</dt>
            <dd>{sourceCopy}</dd>
          </div>
          <div>
            <dt>{copy.order.whoPays}</dt>
            <dd data-testid={`order-gift-cost-${lineKey}`}>
              {interpolate(copy.order.customerPays, { price: formatAmount(0, currency) })}
              {costState === 'unavailable' ? null : ' · '}
              {costState === 'loading'
                ? copy.cost.loading
                : costState === 'failed'
                  ? copy.cost.failed
                  : costState === 'unavailable'
                    ? null
                    : costNet === undefined || costNet === null
                      ? copy.order.costUnknown
                      : interpolate(copy.order.costsYou, { cost: formatAmount(costNet, currency) })}
            </dd>
          </div>
          <div>
            <dt>{copy.order.onDocument}</dt>
            <dd data-testid={`order-gift-doc-form-${lineKey}`}>
              {labels.anyShort(resolved.form)}
              {' · '}
              {labels.source(resolved.source, connection?.name)}
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
