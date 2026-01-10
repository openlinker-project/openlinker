/**
 * Connection Service
 *
 * Application service for connection management operations. Wraps the
 * ConnectionPort from core library with validation and error handling.
 * Converts domain exceptions to HTTP exceptions where appropriate.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IConnectionService}
 * @see {@link IConnectionService} for the interface
 * @see {@link ConnectionPort} for the core port
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { IConnectionService } from '../interfaces/connection.service.interface';
import {
  ConnectionPort,
  Connection,
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import { Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ConnectionService implements IConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
  ) {}

  async create(payload: ConnectionCreate): Promise<Connection> {
    try {
      this.logger.log(`Creating connection: ${payload.name} (platform: ${payload.platformType})`);
      const connection = await this.connectionPort.create(payload);
      this.logger.log(`Connection created successfully: ${connection.id} (${connection.name})`);
      return connection;
    } catch (error) {
      this.logger.error(`Failed to create connection: ${payload.name}`, error);
      throw error;
    }
  }

  async list(filters?: ConnectionFilters): Promise<Connection[]> {
    try {
      this.logger.debug(`Listing connections${filters ? ` with filters: ${JSON.stringify(filters)}` : ''}`);
      const connections = await this.connectionPort.list(filters);
      this.logger.debug(`Found ${connections.length} connection(s)`);
      return connections;
    } catch (error) {
      this.logger.error('Failed to list connections', error);
      throw error;
    }
  }

  async get(connectionId: string): Promise<Connection> {
    try {
      this.logger.debug(`Getting connection: ${connectionId}`);
      const connection = await this.connectionPort.get(connectionId);
      this.logger.debug(`Connection retrieved: ${connection.id} (${connection.name}, status: ${connection.status})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to get connection: ${connectionId}`, error);
      throw error;
    }
  }

  async update(
    connectionId: string,
    patch: ConnectionUpdate,
  ): Promise<Connection> {
    try {
      this.logger.log(`Updating connection: ${connectionId}${patch.status ? ` (status: ${patch.status})` : ''}`);
      const connection = await this.connectionPort.update(connectionId, patch);
      this.logger.log(`Connection updated successfully: ${connection.id} (status: ${connection.status})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found for update: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to update connection: ${connectionId}`, error);
      throw error;
    }
  }

  async disable(connectionId: string): Promise<Connection> {
    try {
      this.logger.log(`Disabling connection: ${connectionId}`);
      const connection = await this.connectionPort.disable(connectionId);
      this.logger.log(`Connection disabled successfully: ${connection.id} (${connection.name})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found for disable: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to disable connection: ${connectionId}`, error);
      throw error;
    }
  }
}

