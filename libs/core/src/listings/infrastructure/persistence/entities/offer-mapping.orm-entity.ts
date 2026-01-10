/**
 * Offer Mapping ORM Entity
 *
 * TypeORM entity representing the offer_mappings table in PostgreSQL.
 * Stores mappings between marketplace offers and internal OpenLinker products.
 * Generic design supports multiple marketplace platforms without per-platform schema.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('offer_mappings')
@Index(['connectionId', 'offerId'], { unique: true })
@Index(['internalProductId'])
@Index(['platformType', 'connectionId'])
export class OfferMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  connectionId!: string;

  @Column()
  platformType!: string;

  @Column()
  offerId!: string;

  @Column()
  internalProductId!: string;

  @Column({ type: 'varchar', nullable: true })
  variantId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


