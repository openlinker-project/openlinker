/**
 * Listing Sale Hold Domain Entity (#3962)
 *
 * OpenLinker's record that it took one listing (a marketplace offer or a shop
 * product) off sale because the product or variant was deleted at the
 * master, and how. It is what lets the product page say what was done on
 * each channel, and what makes "put it back on sale" an operator action
 * rather than something that happens silently when the product comes back.
 *
 * Pure domain object - no framework or persistence concerns.
 *
 * @module libs/core/src/listings/domain/entities
 */
import type {
  ListingSaleHoldEntityType,
  ListingSaleHoldMethod,
  ListingSaleHoldOutcome,
  ListingSaleHoldProps,
  ListingSaleHoldReason,
} from '../types/listing-sale-hold.types';

export class ListingSaleHold {
  readonly id: string;
  readonly connectionId: string;
  readonly entityType: ListingSaleHoldEntityType;
  readonly externalId: string;
  readonly externalParentId: string | null;
  readonly internalProductId: string;
  readonly internalVariantId: string | null;
  readonly method: ListingSaleHoldMethod;
  readonly outcome: ListingSaleHoldOutcome;
  readonly outcomeReason: ListingSaleHoldReason | null;
  readonly staleAt: Date;
  readonly appliedAt: Date;
  readonly releasedAt: Date | null;
  readonly releasedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ListingSaleHoldProps) {
    this.id = props.id;
    this.connectionId = props.connectionId;
    this.entityType = props.entityType;
    this.externalId = props.externalId;
    this.externalParentId = props.externalParentId;
    this.internalProductId = props.internalProductId;
    this.internalVariantId = props.internalVariantId;
    this.method = props.method;
    this.outcome = props.outcome;
    this.outcomeReason = props.outcomeReason;
    this.staleAt = props.staleAt;
    this.appliedAt = props.appliedAt;
    this.releasedAt = props.releasedAt;
    this.releasedBy = props.releasedBy;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Still in force: nobody has put the listing back on sale yet. */
  get isActive(): boolean {
    return this.releasedAt === null;
  }

  /** The listing may still be selling: the hold could not stop it. */
  get needsAttention(): boolean {
    return this.isActive && this.outcome !== 'applied';
  }
}
