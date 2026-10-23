/**
 * Fulfillment Routing Rule ORM Entity
 *
 * TypeORM entity for the `fulfillment_routing_rules` table — the general
 * fulfillment-routing model (#832) generalizing `connection_carrier_mappings`.
 * One rule per `(source_connection_id, source_delivery_method_id)`.
 *
 * FK constraints (`source_connection_id` + `processor_connection_id` →
 * `connections` ON DELETE CASCADE) are emitted by the migration, mirroring the
 * `connection_carrier_mappings` convention; the entity declares only the
 * unique index.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { FulfillmentProcessorKind } from '../../../domain/types/fulfillment-routing.types';

@Entity('fulfillment_routing_rules')
@Index(['sourceConnectionId', 'sourceDeliveryMethodId'], { unique: true })
export class FulfillmentRoutingRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'source_connection_id' })
  sourceConnectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'source_delivery_method_id' })
  sourceDeliveryMethodId!: string;

  @Column({ type: 'varchar', length: 32, name: 'processor_kind' })
  processorKind!: FulfillmentProcessorKind;

  @Column({ type: 'uuid', name: 'processor_connection_id' })
  processorConnectionId!: string;

  @Column({ type: 'varchar', length: 32, name: 'parcel_template', nullable: true })
  parcelTemplate!: string | null;

  @Column({ type: 'integer', name: 'parcel_length_mm', nullable: true })
  parcelLengthMm!: number | null;

  @Column({ type: 'integer', name: 'parcel_width_mm', nullable: true })
  parcelWidthMm!: number | null;

  @Column({ type: 'integer', name: 'parcel_height_mm', nullable: true })
  parcelHeightMm!: number | null;

  @Column({ type: 'integer', name: 'parcel_default_weight_grams', nullable: true })
  parcelDefaultWeightGrams!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
