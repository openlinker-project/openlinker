/**
 * Release center requests (#4148)
 *
 * The panel does not own the guided tour or the "What's new" dialog (separate
 * slices), so it asks for them through a tiny subscription seam instead of
 * importing them. Whoever mounts the tour or the dialog subscribes; with no
 * subscriber a request is simply dropped.
 *
 * @module features/release-center
 */

export interface TourRequest {
  /** Start at this step; absent means from the first step the viewer can act on. */
  stepId?: string;
  connectionId?: string | null;
  /** Walk only this showcase, from its first stop (replay). */
  showcaseId?: string;
  /** Walk these setup steps again even though they are finished (the card's "go through it again"). */
  replaySteps?: { stepId: string; connectionId: string | null; importance: 'required' | 'optional' }[];
  /** Showcases walked after `replaySteps`. */
  replayShowcaseIds?: string[];
  /** Walk the showcases of this `major.minor`, from the first one not seen yet. */
  showcaseMinor?: string;
}

export interface WhatsNewRequest {
  /** `major.minor` of the release the panel was showing. */
  minor?: string;
}

type Listener<T> = (request: T) => void;

function createChannel<T>(): {
  subscribe: (listener: Listener<T>) => () => void;
  request: (payload: T) => void;
} {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (payload) => {
      listeners.forEach((listener) => listener(payload));
    },
  };
}

const tourChannel = createChannel<TourRequest>();
const whatsNewChannel = createChannel<WhatsNewRequest>();

export const subscribeToTourRequests = tourChannel.subscribe;
export const requestReleaseTour = tourChannel.request;
export const subscribeToWhatsNewRequests = whatsNewChannel.subscribe;
export const requestWhatsNew = whatsNewChannel.request;
