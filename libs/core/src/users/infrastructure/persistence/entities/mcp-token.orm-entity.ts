/**
 * MCP Token ORM Entity
 *
 * TypeORM entity for the `mcp_tokens` table (#1486). Stores the SHA-256
 * hash of the raw token (raw token never persisted), the granted scopes,
 * and the RFC 8707 resource binding.
 *
 * `user_id` carries a DB-level FK with ON DELETE CASCADE, declared in the
 * migration — exactly the `refresh_tokens` precedent, which does the same
 * while likewise omitting a TypeORM relation decorator here. Deleting a
 * user destroys their credentials structurally rather than relying on the
 * verifier's user lookup happening to miss.
 *
 * @module libs/core/src/users/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('mcp_tokens')
export class McpTokenOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'scopes', type: 'text', array: true })
  scopes!: string[];

  @Column({ name: 'resource', type: 'varchar', length: 512 })
  resource!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // NOT NULL: the MCP SDK rejects an AuthInfo with an unset expiresAt.
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 64, nullable: true })
  revokedReason!: string | null;
}
