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
import { AllegroQuantityCommand, AllegroQuantityCommandStatus } from '../entities/allegro-quantity-command.entity';

/**
 * Command query filters
 */
export interface AllegroQuantityCommandFilters {
  connectionId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Allegro Quantity Command Repository Port
 *
 * Interface for Allegro quantity command persistence operations.
 */
export interface AllegroQuantityCommandRepositoryPort {
  /**
   * Find command by commandId
   *
   * @param commandId - Allegro command ID
   * @returns Command record or null if not found
   */
  findByCommandId(commandId: string): Promise<AllegroQuantityCommand | null>;

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
  updateStatus(commandId: string, status: AllegroQuantityCommandStatus, error?: string | null): Promise<AllegroQuantityCommand>;
}

