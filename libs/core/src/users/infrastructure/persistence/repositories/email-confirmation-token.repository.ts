/**
 * Email Confirmation Token Repository
 *
 * Implements EmailConfirmationTokenRepositoryPort using TypeORM.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 * @implements {EmailConfirmationTokenRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EmailConfirmationToken } from '../../../domain/entities/email-confirmation-token.entity';
import type { EmailConfirmationTokenRepositoryPort } from '../../../domain/ports/email-confirmation-token-repository.port';
import { EmailConfirmationTokenOrmEntity } from '../entities/email-confirmation-token.orm-entity';

@Injectable()
export class EmailConfirmationTokenRepository implements EmailConfirmationTokenRepositoryPort {
  constructor(
    @InjectRepository(EmailConfirmationTokenOrmEntity)
    private readonly ormRepository: Repository<EmailConfirmationTokenOrmEntity>
  ) {}

  async save(
    token: Pick<EmailConfirmationToken, 'userId' | 'tokenHash' | 'expiresAt'>
  ): Promise<EmailConfirmationToken> {
    const entity = this.ormRepository.create({
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      usedAt: null,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async consumeToken(tokenHash: string, now: Date): Promise<string | null> {
    const result = await this.ormRepository
      .createQueryBuilder()
      .update(EmailConfirmationTokenOrmEntity)
      .set({ usedAt: now })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > :now', { now })
      // Entity PROPERTY name ('userId'), not the raw DB column name
      // ('user_id') — TypeORM's QueryBuilder#returning resolves entries
      // against column metadata keyed by property name and silently emits
      // no RETURNING output for a name it can't match (#1649: `affected: 1`
      // but `raw: []`, so this always returned null even though the token
      // was correctly consumed — the account got permanently stuck in
      // `pending_confirmation` with a burned, unusable token).
      .returning(['userId'])
      .execute();

    const row = (result.raw as Array<{ user_id: string }>)[0];
    return row ? row.user_id : null;
  }

  async invalidateActiveForUser(userId: string, now: Date): Promise<void> {
    await this.ormRepository.update({ userId, usedAt: IsNull() }, { usedAt: now });
  }

  private toDomain(entity: EmailConfirmationTokenOrmEntity): EmailConfirmationToken {
    return new EmailConfirmationToken(
      entity.id,
      entity.userId,
      entity.tokenHash,
      entity.expiresAt,
      entity.usedAt,
      entity.createdAt
    );
  }
}
