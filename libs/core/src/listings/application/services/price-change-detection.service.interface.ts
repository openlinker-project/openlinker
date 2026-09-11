/**
 * Price Change Detection Service Interface (#3143, ADR-072)
 *
 * @module libs/core/src/listings/application/services
 */
import type { MasterPriceChangeObservation, PriceChangeObserverPort } from '@openlinker/core/products';

export interface IPriceChangeDetectionService extends PriceChangeObserverPort {
  onMasterPriceChanged(observation: MasterPriceChangeObservation): Promise<void>;
}
