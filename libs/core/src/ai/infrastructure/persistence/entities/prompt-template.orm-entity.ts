/**
 * Prompt Template ORM Entity
 *
 * TypeORM mapping for the `prompt_templates` table. Index design mirrors
 * `product-content-field.orm-entity.ts`: partial unique indexes honour
 * Postgres' NULL-distinct semantics on the nullable `channel` column, and
 * two additional partial unique indexes keep exactly one `published` row
 * per `(key, channel)` pair (one for the master path, one for channels).
 *
 * The decorators declare the indexes here so `synchronize: true` (used by
 * the integration-test harness) materialises them. Production DBs get the
 * identical indexes via the DDL migration, which remains the source of
 * truth.
 *
 * @module libs/core/src/ai/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PromptTemplateVariable } from '../../../domain/types/prompt-template.types';

@Entity('prompt_templates')
@Index('ix_prompt_templates_key_channel', ['key', 'channel', 'state'])
@Index('ux_prompt_templates_kcv_master', ['key', 'version'], {
  unique: true,
  where: '"channel" IS NULL',
})
@Index('ux_prompt_templates_kcv_channel', ['key', 'channel', 'version'], {
  unique: true,
  where: '"channel" IS NOT NULL',
})
@Index('ux_prompt_templates_published_master', ['key'], {
  unique: true,
  where: `"channel" IS NULL AND "state" = 'published'`,
})
@Index('ux_prompt_templates_published_channel', ['key', 'channel'], {
  unique: true,
  where: `"channel" IS NOT NULL AND "state" = 'published'`,
})
export class PromptTemplateOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'key', type: 'text' })
  key!: string;

  @Column({ name: 'channel', type: 'text', nullable: true })
  channel!: string | null;

  @Column({ name: 'version', type: 'integer' })
  version!: number;

  @Column({ name: 'system_prompt', type: 'text' })
  systemPrompt!: string;

  @Column({ name: 'user_prompt_template', type: 'text' })
  userPromptTemplate!: string;

  // Stored as JSONB; typed as the domain shape so TypeORM's `_QueryDeepPartialEntity`
  // accepts it in `.set(...)`. Content is validated at the DTO boundary and the
  // repository narrows back to the domain type on read.
  @Column({ name: 'variables', type: 'jsonb' })
  variables!: PromptTemplateVariable[];

  @Column({ name: 'state', type: 'text' })
  state!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
