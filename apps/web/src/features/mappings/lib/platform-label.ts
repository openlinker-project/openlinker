/**
 * Platform-label resolver (#1784 follow-up)
 *
 * Resolves a connection's human-readable platform label from the plugin
 * registry, falling back to the raw `platformType` when no plugin is
 * registered for it. Extracted so the Mapping Configuration page and the
 * `MappingPairingBar` share one implementation instead of duplicating the
 * `platforms.find(...)?.displayName ?? platformType` lookup.
 *
 * @module apps/web/src/features/mappings/lib
 */

interface PlatformLike {
  platformType: string;
  displayName: string;
}

interface ConnectionLike {
  platformType: string;
}

export function resolvePlatformLabel(
  platforms: readonly PlatformLike[],
  connection: ConnectionLike,
): string {
  return (
    platforms.find((p) => p.platformType === connection.platformType)?.displayName ??
    connection.platformType
  );
}
