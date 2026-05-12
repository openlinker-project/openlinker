/**
 * Adapters — public surface
 *
 * Public barrel for the adapters feature (#609). Cross-feature consumers
 * (today: `features/connections` for the PrestaShop setup form) import the
 * adapter-discovery query from here.
 */
export { useAdaptersQuery } from './hooks/use-adapters-query';
