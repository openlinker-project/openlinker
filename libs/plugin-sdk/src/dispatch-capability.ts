/**
 * dispatchCapability — single seam for the capability → adapter cast (#573)
 *
 * `AdapterPlugin.createCapabilityAdapter<T>` receives `capability: string` and
 * a generic `T` chosen by the caller (`IntegrationsService.getCapabilityAdapter<T>`).
 * There is no compile-time link between the two — and there cannot be at this
 * layer, because `supportedCapabilities` is an open string set (per #576):
 * plugin packages register capability names at runtime, so a closed
 * `Record<Capability, AdapterPort>` keyed by literal capability names can't
 * exist statically.
 *
 * The plugin author's job is therefore a runtime dispatch: "given the string
 * `capability` and a per-capability factory map, return the matching adapter,
 * or throw if the capability isn't supported." Without this helper, each
 * plugin writes the same `switch` block with one `as unknown as T` per case
 * (6 occurrences across `allegro-plugin.ts` + `prestashop-plugin.ts` pre-#573).
 *
 * With this helper, the cast lives in one place — the helper's single
 * `factory() as T` — and plugin authors declare a typed `Record<string, () =>
 * AdapterImpl>` dispatch table with no per-case casts. The contract on the
 * plugin author is unchanged ("if you list `'OfferManager'` in your dispatch
 * table, you have promised it returns `OfferManagerPort`"), but the
 * boilerplate is gone and the error message format is consistent across
 * plugins.
 *
 * **Plugin-authored compile-time enforcement** is still possible — a plugin
 * package can wrap `dispatchCapability` with a typed `CapabilityMap` keyed on
 * its own (closed) literal capability set:
 *
 *   type AllegroCapabilityMap = {
 *     OfferManager: OfferManagerPort;
 *     OrderSource: OrderSourcePort;
 *   };
 *   function dispatchAllegro<K extends keyof AllegroCapabilityMap>(
 *     capability: K, table: AllegroCapabilityMap, …
 *   ): AllegroCapabilityMap[K] { … }
 *
 * Only the SDK seam itself has to stay capability-open (#576).
 *
 * @module libs/plugin-sdk/src
 */

/**
 * Dispatch a capability name to its factory and return the constructed
 * adapter cast to `T`.
 *
 * @param capability - The capability requested by the caller (e.g.
 *   `'OfferManager'`). Treated as an open string set per #576.
 * @param table - Per-capability factory map. Keys are the capability names
 *   the plugin supports; values are zero-arg functions returning the matching
 *   adapter instance. Factories are invoked lazily — only the requested
 *   capability's factory runs.
 * @param pluginName - Human-readable plugin identifier used in error
 *   messages (e.g. `'Allegro'`, `'PrestaShop'`). Surfaces in the
 *   `CapabilityNotSupportedByPluginError` thrown when `capability` isn't a
 *   key in `table`.
 * @returns The factory's return value, cast to `T`.
 * @throws Error when `capability` is not a key in `table`. The error message
 *   includes the plugin name, the requested capability, and the supported
 *   set, so operators can diagnose "did the plugin forget to register it?"
 *   versus "did the call site ask for the wrong name?"
 */
export function dispatchCapability<T>(
  capability: string,
  table: Record<string, () => unknown>,
  pluginName: string,
): T {
  // `Object.hasOwn` instead of `table[capability]` truthiness — keeps the
  // helper safe against inherited prototype keys (`'hasOwnProperty'`,
  // `'toString'`, `'__proto__'`, …). Without this, `table['hasOwnProperty']`
  // would resolve to `Object.prototype.hasOwnProperty` and call it, returning
  // a bogus `false as T` instead of the supported-capabilities error. The
  // upstream `metadata.supportedCapabilities.includes(...)` gate makes the
  // exploit path narrow today, but the helper is the plugin-author seam —
  // defensive lookup belongs here, not at the gate.
  const factory = Object.hasOwn(table, capability) ? table[capability] : undefined;
  if (!factory) {
    throw new Error(
      `${pluginName} adapter does not support capability: ${capability}. ` +
        `Supported capabilities: ${Object.keys(table).join(', ') || '<none>'}`,
    );
  }
  return factory() as T;
}
