/**
 * Guided tour public contract (#4149)
 *
 * The dialog (#4147) and the bell (#4148) start a tour through `useTour()`;
 * they pass the steps to walk and the importance they already computed, so the
 * tour never re-derives which steps apply.
 *
 * @module features/release-center/tour
 */
import { createContext, useContext } from 'react';
import type { ReleaseStepImportance } from '../catalog/release-step.types';

export interface TourStepInput {
  /** Catalog step id. */
  stepId: string;
  /** Set for connection-scoped steps. */
  connectionId: string | null;
  importance: ReleaseStepImportance;
}

export interface TourController {
  isActive: boolean;
  /** `trigger` receives focus again when the tour closes. */
  start: (steps: readonly TourStepInput[], trigger?: HTMLElement | null) => void;
  close: () => void;
}

const INACTIVE: TourController = { isActive: false, start: () => undefined, close: () => undefined };

export const TourContext = createContext<TourController>(INACTIVE);

export function useTour(): TourController {
  return useContext(TourContext);
}
