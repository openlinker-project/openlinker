/**
 * Stream Dead Letter ORM Entity
 *
 * TypeORM mapping for `stream_dead_letters` (#2301, D48). Uniqueness on
 * `(stream, consumer_group, entry_id)` is the upsert's conflict target — see
 * `StreamDeadLetterRepository.upsert`.
 *
 * @module libs/core/src/events/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('stream_dead_letters')
@Index('IDX_stream_dead_letters_stream_group_entry', ['stream', 'consumerGroup', 'entryId'], {
  unique: true,
})
@Index('IDX_stream_dead_letters_last_seen_at', ['lastSeenAt'])
export class StreamDeadLetterOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  stream!: string;

  @Column({ type: 'text', name: 'consumer_group' })
  consumerGroup!: string;

  @Column({ type: 'text', name: 'entry_id' })
  entryId!: string;

  @Column({ type: 'jsonb', name: 'raw_fields' })
  rawFields!: Record<string, string>;

  @Column({ type: 'integer' })
  attempts!: number;

  @Column({ type: 'text', name: 'last_error' })
  lastError!: string;

  @Column({ type: 'timestamptz', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
