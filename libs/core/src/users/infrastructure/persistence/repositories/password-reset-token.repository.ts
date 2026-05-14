/**
 * Password Reset Token Repository
 *
 * Implements PasswordResetTokenRepositoryPort using TypeORM.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 * @implements {PasswordResetTokenRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PasswordResetToken } from '../../../domain/entities/password-reset-token.entity';
import type { PasswordResetTokenRepositoryPort } from '../../../domain/ports/password-reset-token-repository.port';
import { PasswordResetTokenOrmEntity } from '../entities/password-reset-token.orm-entity';

@Injectable()
export class PasswordResetTokenRepository implements PasswordResetTokenRepositoryPort {
  constructor(
    @InjectRepository(PasswordResetTokenOrmEntity)
    private readonly ormRepository: Repository<PasswordResetTokenOrmEntity>
  ) {}

  async save(
    token: Pick<PasswordResetToken, 'userId' | 'tokenHash' | 'expiresAt'>
  ): Promise<PasswordResetToken> {
    const entity = this.ormRepository.create({
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      usedAt: null,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    const entity = await this.ormRepository.findOne({ where: { tokenHash } });
    return entity ? this.toDomain(entity) : null;
  }

  async markUsed(id: string, usedAt: Date): Promise<void> {
    await this.ormRepository.update({ id }, { usedAt });
  }

  async invalidateActiveForUser(userId: string, now: Date): Promise<void> {
    await this.ormRepository.update({ userId, usedAt: IsNull() }, { usedAt: now });
  }

  private toDomain(entity: PasswordResetTokenOrmEntity): PasswordResetToken {
    return new PasswordResetToken(
      entity.id,
      entity.userId,
      entity.tokenHash,
      entity.expiresAt,
      entity.usedAt,
      entity.createdAt
    );
  }
}
