/**
 * Refresh Token ORM Entity
 *
 * TypeORM entity for the `refresh_tokens` table. Stores the SHA-256
 * hash of the raw token (raw token never persisted) plus the rotation
 * chain link (`rotatedFromId`). Audit columns (user-agent, IP) are
 * intentionally deferred until an active-sessions admin UI lands.
 *
 * @module libs/core/src/users/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('refresh_tokens')
export class RefreshTokenOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Index()
  @Column({ name: 'rotated_from_id', type: 'uuid', nullable: true })
  rotatedFromId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 64, nullable: true })
  revokedReason!: string | null;
}
