/**
 * OMS routing UI flag (#3634)
 *
 * Gates every operator surface that only exists to configure OMS fulfilment
 * routing: `/inventory/locations`, `/settings/sourcing-rules`, their Settings
 * tiles, the connection Health tab's routing-readiness panel and the
 * stock-location override on connection edit.
 *
 * Off by default. The router those surfaces configure decides nothing on an
 * install whose `InventoryMaster` adapters report no location (neither shipped
 * adapter does), so showing them presents configuration with no effect. The API
 * behind them stays registered; only the UI is withheld.
 *
 * Build-time, like every `VITE_*` input: changing it needs a rebuild. Read on
 * every call rather than captured at module load so a test can stub the env.
 *
 * @module shared/config
 */

/** Only the literal `'true'` enables it, so a typo fails closed. */
export function resolveOmsRoutingUiEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}

export function isOmsRoutingUiEnabled(): boolean {
  return resolveOmsRoutingUiEnabled(
    (import.meta.env as Record<string, string | undefined>).VITE_OL_OMS_ROUTING_UI_ENABLED
  );
}
