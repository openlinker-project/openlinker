/**
 * Channel markers for a gift rule (#3940, gifts spec section 7)
 *
 * Every channel the rule may fire on carries one short marker: either the
 * channel itself can also know gifts (a shop with cart rules or a gift app, so a
 * double gift is possible and "skip if already in the order" is the guard), or
 * the gift exists only through OpenLinker (Allegro and Erli know no gifts). The
 * marker is read off the platform's kind, never off a name typed by the
 * operator.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { Connection } from '../../connections';

/** Platforms whose own gift mechanisms (cart rules, gift apps, plugins) may add the same gift. */
const SHOP_PLATFORMS: readonly string[] = ['prestashop', 'woocommerce', 'shoper', 'idosell'];

export type GiftChannelMarker = 'native' | 'openlinker';

export function channelMarker(platformType: string): GiftChannelMarker {
  return SHOP_PLATFORMS.includes(platformType) ? 'native' : 'openlinker';
}

/** Connections that can bring orders in, active or not (a rule may name a paused one). */
export function orderSourceChannels(connections: readonly Connection[]): Connection[] {
  return connections.filter((c) => c.enabledCapabilities.includes('OrderSource'));
}

/** True when any channel the rule covers could also give the gift itself. */
export function coversNativeChannel(
  selectedIds: readonly string[],
  channels: readonly Connection[],
): boolean {
  const covered = selectedIds.length === 0 ? channels : channels.filter((c) => selectedIds.includes(c.id));
  return covered.some((c) => channelMarker(c.platformType) === 'native');
}
