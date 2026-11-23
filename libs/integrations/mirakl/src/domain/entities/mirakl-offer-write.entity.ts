/**
 * Mirakl Offer Write Entity
 *
 * One recorded stock or price change for one offer (see
 * `mirakl-offer-write.types.ts`). `version` grows every time a pending value
 * is replaced, so a submit marks only the version it actually sent.
 *
 * @module libs/integrations/mirakl/src/domain/entities
 */
import type {
  MiraklOfferWriteKind,
  MiraklOfferWriteStatus,
} from '../types/mirakl-offer-write.types';

export class MiraklOfferWrite {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly kind: MiraklOfferWriteKind,
    public readonly offerSku: string,
    public readonly value: string,
    public readonly currency: string | null,
    public readonly status: MiraklOfferWriteStatus,
    public readonly importId: string | null,
    public readonly version: number,
    public readonly error: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
