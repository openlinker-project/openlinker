/**
 * Refresh Token Repository
 *
 * Implements RefreshTokenRepositoryPort using TypeORM. `revokeChain`
 * uses two `WITH RECURSIVE` CTEs (one walking descendants via
 * `rotated_from_id = ancestor.id`, the other walking ancestors via
 * `ancestor.rotated_from_id = parent.id`) unioned before a single
 * `UPDATE`. Splitting the directions avoids the per-row correlated
 * subquery the naive form would emit.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 * @implements {RefreshTokenRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../../../domain/entities/refresh-token.entity';
import type { RefreshTokenRepositoryPort } from '../../../domain/ports/refresh-token-repository.port';
import {
  parseRefreshTokenRevocationReason,
  type RefreshTokenRevocationReason,
} from '../../../domain/types/refresh-token.types';
import { RefreshTokenOrmEntity } from '../entities/refresh-token.orm-entity';

@Injectable()
export class RefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(
    @InjectRepository(RefreshTokenOrmEntity)
    private readonly ormRepository: Repository<RefreshTokenOrmEntity>,
  ) {}

  async insert(token: RefreshToken): Promise<RefreshToken> {
    const entity = this.ormRepository.create({
      id: token.id,
      userId: token.userId,
      tokenHash: token.tokenHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      rotatedFromId: token.rotatedFromId,
      revokedAt: token.revokedAt,
      revokedReason: token.revokedReason,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const entity = await this.ormRepository.findOne({ where: { tokenHash } });
    return entity ? this.toDomain(entity) : null;
  }

  async revoke(
    id: string,
    reason: RefreshTokenRevocationReason,
    at: Date = new Date(),
  ): Promise<void> {
    await this.ormRepository
      .createQueryBuilder()
      .update(RefreshTokenOrmEntity)
      .set({ revokedAt: at, revokedReason: reason })
      .where('id = :id AND revoked_at IS NULL', { id })
      .execute();
  }

  async revokeChain(tokenId: string, reason: RefreshTokenRevocationReason): Promise<void> {
    await this.ormRepository.manager.query(
      `
      WITH RECURSIVE descendants AS (
        SELECT id, rotated_from_id FROM refresh_tokens WHERE id = $1
        UNION
        SELECT rt.id, rt.rotated_from_id
          FROM refresh_tokens rt
          JOIN descendants d ON rt.rotated_from_id = d.id
      ),
      ancestors AS (
        SELECT id, rotated_from_id FROM refresh_tokens WHERE id = $1
        UNION
        SELECT rt.id, rt.rotated_from_id
          FROM refresh_tokens rt
          JOIN ancestors a ON a.rotated_from_id = rt.id
      )
      UPDATE refresh_tokens
         SET revoked_at = now(), revoked_reason = $2
       WHERE id IN (
         SELECT id FROM descendants UNION SELECT id FROM ancestors
       )
         AND revoked_at IS NULL
      `,
      [tokenId, reason],
    );
  }

  private toDomain(entity: RefreshTokenOrmEntity): RefreshToken {
    return new RefreshToken(
      entity.id,
      entity.userId,
      entity.tokenHash,
      entity.issuedAt,
      entity.expiresAt,
      entity.rotatedFromId,
      entity.revokedAt,
      parseRefreshTokenRevocationReason(entity.revokedReason),
    );
  }
}
