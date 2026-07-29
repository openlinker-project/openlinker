/**
 * MCP Token Repository
 *
 * Implements McpTokenRepositoryPort using TypeORM (#1486).
 *
 * No unique-violation → domain-error conversion is performed on insert: the
 * only unique constraint is on `token_hash`, whose value is a 256-bit CSPRNG
 * draw. A collision is not realistically reachable, so introducing a domain
 * exception for it would be dead code. Any such error propagates as an
 * infrastructure failure.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 * @implements {McpTokenRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpToken } from '../../../domain/entities/mcp-token.entity';
import type { McpTokenRepositoryPort } from '../../../domain/ports/mcp-token-repository.port';
import {
  parseMcpTokenRevocationReason,
  parseMcpTokenScopes,
  type McpTokenRevocationReason,
} from '../../../domain/types/mcp-token.types';
import { McpTokenOrmEntity } from '../entities/mcp-token.orm-entity';

@Injectable()
export class McpTokenRepository implements McpTokenRepositoryPort {
  constructor(
    @InjectRepository(McpTokenOrmEntity)
    private readonly ormRepository: Repository<McpTokenOrmEntity>
  ) {}

  async insert(token: McpToken): Promise<McpToken> {
    const entity = this.ormRepository.create({
      id: token.id,
      userId: token.userId,
      name: token.name,
      tokenHash: token.tokenHash,
      scopes: [...token.scopes],
      resource: token.resource,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      revokedReason: token.revokedReason,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async findByHash(tokenHash: string): Promise<McpToken | null> {
    const entity = await this.ormRepository.findOne({ where: { tokenHash } });
    return entity ? this.toDomain(entity) : null;
  }

  async findById(id: string): Promise<McpToken | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findMany(userId?: string): Promise<McpToken[]> {
    const entities = await this.ormRepository.find({
      where: userId ? { userId } : {},
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async revoke(
    id: string,
    reason: McpTokenRevocationReason,
    at: Date = new Date()
  ): Promise<void> {
    await this.ormRepository
      .createQueryBuilder()
      .update(McpTokenOrmEntity)
      .set({ revokedAt: at, revokedReason: reason })
      .where('id = :id AND revoked_at IS NULL', { id })
      .execute();
  }

  async touchLastUsed(id: string, at: Date = new Date()): Promise<void> {
    await this.ormRepository
      .createQueryBuilder()
      .update(McpTokenOrmEntity)
      .set({ lastUsedAt: at })
      .where('id = :id', { id })
      .execute();
  }

  private toDomain(entity: McpTokenOrmEntity): McpToken {
    return new McpToken(
      entity.id,
      entity.userId,
      entity.name,
      entity.tokenHash,
      parseMcpTokenScopes(entity.scopes ?? []),
      entity.resource,
      entity.createdAt,
      entity.expiresAt,
      entity.lastUsedAt,
      entity.revokedAt,
      parseMcpTokenRevocationReason(entity.revokedReason)
    );
  }
}
