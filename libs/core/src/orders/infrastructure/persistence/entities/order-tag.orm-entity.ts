/**
 * Order Tag ORM Entity (#3532)
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('order_tags')
export class OrderTagOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  @Index('UQ_order_tags_name', { unique: true })
  name!: string;

  @Column({ type: 'text' })
  color!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
