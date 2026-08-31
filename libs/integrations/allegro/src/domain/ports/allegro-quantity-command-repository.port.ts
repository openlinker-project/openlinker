/**
 * Allegro Quantity Command Repository Port
 *
 * Defines the contract for Allegro quantity command persistence operations.
 * This port interface specifies the persistence methods needed for observability,
 * without exposing infrastructure details (TypeORM, database, etc.).
 *
 * @module libs/integrations/allegro/src/domain/ports
 * @see {@link AllegroQuantityCommandRepository} for the implementation
 */
import type {
  AllegroQuantityCommand,
  AllegroQuantityCommandStatus,
} from '../entities/allegro-quantity-command.entity';

/**
 * Command query filters
 */
export interface AllegroQuantityCommandFilters {
  connectionId?: string;
  status?: string;
  limit?: number;
  offset?: number;
  /**
   * `'newest'` (default) orders `createdAt DESC` — right for an
   * operator-facing list. `'oldest'` orders `createdAt ASC` — required by a
   * bounded reconcile sweep, or a page taken off the DESC ordering re-reads
   * the newest rows on every pass and the oldest pending ones — the ones
   * most likely genuinely stuck — are never revisited.
   */
  orderBy?: 'newest' | 'oldest';
}

/**
 * Allegro Quantity Command Repository Port
 *
 * Interface for Allegro quantity command persistence operations.
 */
export interface AllegroQuantityCommandRepositoryPort {
  /**
   * Find every command record sharing a commandId.
   *
   * A single-item update always yields exactly one row. A batch command
   * (#2622) covers several offers under one Allegro commandId, so this can
   * return more than one row — one per offer named in that command.
   *
   * @param commandId - Allegro command ID
   * @returns Command records for this commandId (empty array if none)
   */
  findByCommandId(commandId: string): Promise<AllegroQuantityCommand[]>;

  /**
   * Find commands by filters
   *
   * @param filters - Query filters (connectionId, status, limit, offset)
   * @returns Array of command records
   */
  find(filters: AllegroQuantityCommandFilters): Promise<AllegroQuantityCommand[]>;

  /**
   * Create a new command record
   *
   * @param command - Command domain entity
   * @returns Created command with generated ID
   * @throws Error if commandId already exists
   */
  create(command: AllegroQuantityCommand): Promise<AllegroQuantityCommand>;

  /**
   * Update command status and error
   *
   * @param commandId - Allegro command ID
   * @param status - New status
   * @param error - Error message (optional)
   * @returns Updated command
   * @throws Error if command not found
   */
  updateStatus(
    commandId: string,
    status: AllegroQuantityCommandStatus,
    error?: string | null
  ): Promise<AllegroQuantityCommand>;

  /**
   * Update status and error for one offer's row within a (possibly batched)
   * command. Unlike `updateStatus`, this disambiguates by (commandId,
   * offerId) — required once a single commandId can back several rows.
   *
   * @param commandId - Allegro command ID
   * @param offerId - The offer whose row should be updated
   * @param status - New status
   * @param error - Error message (optional)
   * @returns Updated command
   * @throws Error if no row exists for (commandId, offerId)
   */
  updateOfferStatus(
    commandId: string,
    offerId: string,
    status: AllegroQuantityCommandStatus,
    error?: string | null
  ): Promise<AllegroQuantityCommand>;
}
