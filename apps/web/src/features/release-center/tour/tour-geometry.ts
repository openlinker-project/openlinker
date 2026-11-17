/**
 * Tour geometry (#4154)
 *
 * Pure placement maths. The ring always frames the WHOLE target and is placed
 * in document coordinates, so native scrolling moves it with the content and
 * nothing is re-measured per scroll event. Only the card is fixed to the
 * viewport; its dock side is picked from the part of the target that is
 * actually on screen so it covers as little of it as possible.
 *
 * @module features/release-center/tour
 */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TourDock = 'bottom' | 'right';

export const RING_PADDING = 8;
export const CARD_EDGE = 16;
export const CARD_GAP = 16;
export const NARROW_VIEWPORT = 640;
const RIGHT_DOCK_WIDTH = 340;
/** A dock only replaces the current one when it frees at least this share of the card's area. */
const SWITCH_GAIN = 0.2;

/** The ring box in document coordinates: the target's full bounding box plus padding. */
export function ringBoxInDocument(rect: Box, scroll: { x: number; y: number }): Box {
  return {
    top: rect.top + scroll.y - RING_PADDING,
    left: rect.left + scroll.x - RING_PADDING,
    width: rect.width + RING_PADDING * 2,
    height: rect.height + RING_PADDING * 2,
  };
}

/** Space the page keeps free under its last row so any target can scroll clear of a bottom-docked card. */
export function bottomReserve(cardHeight: number): number {
  return Math.ceil(cardHeight + CARD_EDGE + CARD_GAP);
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface DockInput {
  /** Target rect in viewport coordinates. */
  target: Box;
  viewport: { width: number; height: number };
  card: { width: number; height: number };
  /** Lowest y the card may start at when docked beside the content: below the top bar. */
  topInset: number;
  current: TourDock;
}

/** Where the card would sit for a dock, in viewport coordinates. */
export function cardBox(dock: TourDock, input: Pick<DockInput, 'viewport' | 'card' | 'topInset'>): Box {
  const { viewport, card, topInset } = input;
  if (dock === 'right') {
    return {
      top: topInset,
      left: viewport.width - CARD_EDGE - RIGHT_DOCK_WIDTH,
      width: RIGHT_DOCK_WIDTH,
      height: card.height,
    };
  }
  return {
    top: viewport.height - CARD_EDGE - card.height,
    left: viewport.width - CARD_EDGE - card.width,
    width: card.width,
    height: card.height,
  };
}

export function chooseDock(input: DockInput): TourDock {
  if (input.viewport.width < NARROW_VIEWPORT) return 'bottom';
  const area = (dock: TourDock): number => overlapArea(input.target, cardBox(dock, input));
  const other: TourDock = input.current === 'bottom' ? 'right' : 'bottom';
  const cardArea = input.card.width * input.card.height;
  // Hysteresis: scrolling must not make the card flip back and forth.
  return area(input.current) - area(other) > cardArea * SWITCH_GAIN ? other : input.current;
}
