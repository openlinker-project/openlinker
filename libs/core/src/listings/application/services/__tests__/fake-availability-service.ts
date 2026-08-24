/**
 * Fake availability seam for the listings publish-builder specs (#2323)
 *
 * The builders no longer read `Connection.config.stockSafetyBuffer` — the
 * availability seam does. This fake resolves the buffer from whatever the
 * spec's `connectionPort` mock is currently returning, so a test that
 * configures a buffer the way it always did keeps asserting the same
 * published number, and the parity of the rewire is visible rather than
 * papered over by a hand-fed constant.
 *
 * The coercion mirrors `readStockSafetyBuffer` deliberately: a fake that
 * accepted `"5"` where production coerces it to `0` would hide exactly the
 * misconfiguration these specs exist to pin.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

/** `readStockSafetyBuffer`'s coercion: positive finite integers only. */
function coerceBuffer(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/**
 * @param getConnection how the spec resolves the connection under test — the
 *   spec's own `connectionPort.get` mock, so reconfiguring it mid-test moves
 *   the buffer exactly as it does in production.
 */
export function createFakeAvailabilityService(
  getConnection: (connectionId: string) => Promise<{ config?: Record<string, unknown> | null }>
): {
  applyPublishControls: jest.Mock;
  getPromisableQuantities: jest.Mock;
  getAppliedReserve: jest.Mock;
} {
  const bufferFor = async (connectionId: string): Promise<number> => {
    const connection = await getConnection(connectionId);
    return coerceBuffer(connection?.config?.['stockSafetyBuffer']);
  };

  return {
    applyPublishControls: jest
      .fn()
      .mockImplementation(
        async ({
          quantity,
          scope,
        }: {
          quantity: number;
          scope: { kind: string; connectionId?: string };
        }) => {
          const buffer =
            scope.kind === 'channel' && scope.connectionId
              ? await bufferFor(scope.connectionId)
              : 0;
          return {
            quantity: Math.max(0, Math.max(0, quantity) - buffer),
            provenance: 'computed' as const,
          };
        }
      ),
    getPromisableQuantities: jest.fn().mockResolvedValue([]),
    getAppliedReserve: jest
      .fn()
      .mockImplementation(async (scope: { kind: string; connectionId?: string }) =>
        scope.kind === 'channel' && scope.connectionId ? bufferFor(scope.connectionId) : 0
      ),
  };
}
