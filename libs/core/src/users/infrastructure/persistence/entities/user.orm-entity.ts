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

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'analytics_consent', type: 'boolean', default: false })
  analyticsConsent!: boolean;

  /**
   * Free-text label the packer types in for their own bench/printer (#3424,
   * mockup-parity epic #3401) — e.g. "Bench 3 / Zebra ZD420". Config, never
   * identity: it carries no authentication weight of its own (ADR-071
   * rejects a station/device *principal* — no station token, no PIN, no
   * badge), so this column is read-and-displayed only, exactly like a
   * connection's own operator-authored `name`.
   */
  @Column({ name: 'pack_station_label', type: 'varchar', nullable: true })
  packStationLabel!: string | null;

  /**
   * Best-effort online-presence heartbeat for the Assign Packing Work board
   * (#3424). Bumped by the bench's own activity, never a login/session
   * event — a signed-in-but-idle packer must read as offline after the
   * presence window elapses. `null` means "never observed active".
   */
  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt!: Date | null;

  /**
   * The person's name as an admin typed it at account creation (#3456), e.g.
   * "Anna Kowalska". `null` for every account created another way; surfaces
   * fall back to `username`, which stays the login.
   */
  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName!: string | null;

  /**
   * Set when an admin creates the account with a one-time password (#3456);
   * cleared by the user's own password change in the same statement that
   * writes the new hash. `PasswordChangeRequiredGuard` enforces it.
   */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
