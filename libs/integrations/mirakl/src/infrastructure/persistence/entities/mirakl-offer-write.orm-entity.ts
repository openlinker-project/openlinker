/**
 * Mirakl Offer Write ORM Entity
 *
 * Table `mirakl_offer_writes` (#4277): stock and price changes waiting to be
 * sent to a Mirakl operator, and the imports that carried them. See
 * `mirakl-offer-write.types.ts` for the lifecycle.
 *
 * At most one `pending` row per (connection, kind, offer): the partial unique
 * index is what lets a newer value replace an unsent one in one statement.
 *
 * @module libs/integrations/mirakl/src/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
// A value import: the column types feed decorator metadata.
import {
  MiraklOfferWriteKind,
  MiraklOfferWriteStatus,
} from '../../../domain/types/mirakl-offer-write.types';

@Entity('mirakl_offer_writes')
@Index('UQ_mirakl_offer_writes_pending', ['connectionId', 'kind', 'offerSku'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('IDX_mirakl_offer_writes_connection_status', ['connectionId', 'status', 'kind'])
@Index('IDX_mirakl_offer_writes_import', ['connectionId', 'importId'])
export class MiraklOfferWriteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  connectionId!: string;

  @Column({ type: 'varchar' })
  kind!: MiraklOfferWriteKind;

  @Column({ type: 'varchar' })
  offerSku!: string;

  /** A whole quantity or a decimal price, as text so no precision is lost. */
  @Column({ type: 'varchar' })
  value!: string;

  @Column({ type: 'varchar', nullable: true })
  currency!: string | null;

  @Column({ type: 'varchar' })
  status!: MiraklOfferWriteStatus;

  @Column({ type: 'varchar', nullable: true })
  importId!: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
