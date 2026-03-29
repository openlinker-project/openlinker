/**
 * User ORM Entity
 *
 * TypeORM entity for the `users` table. Maps between the database schema and
 * the User domain entity. Owned by the infrastructure layer — never exposed
 * directly to application or domain layers.
 *
 * @module libs/core/src/users/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ nullable: true, unique: true, type: 'varchar' })
  email!: string | null;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 50, default: 'admin' })
  role!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
