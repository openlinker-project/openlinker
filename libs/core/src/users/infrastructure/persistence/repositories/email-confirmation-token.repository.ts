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
import { Repository } from 'typeorm';
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

  async findByTokenHash(tokenHash: string): Promise<EmailConfirmationToken | null> {
    const entity = await this.ormRepository.findOne({ where: { tokenHash } });
    return entity ? this.toDomain(entity) : null;
  }

  async markUsed(id: string, usedAt: Date): Promise<void> {
    await this.ormRepository.update({ id }, { usedAt });
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
