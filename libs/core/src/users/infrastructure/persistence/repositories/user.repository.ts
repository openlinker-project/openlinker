/**
 * User Repository
 *
 * Implements UserRepositoryPort using TypeORM. Handles all mapping between
 * UserOrmEntity (infrastructure) and User (domain). Domain types never
 * leak out of this class.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 * @implements {UserRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, QueryFailedError, Repository } from 'typeorm';
import { User } from '../../../domain/entities/user.entity';
import { UserAlreadyExistsException } from '../../../domain/exceptions/user-already-exists.exception';
import type { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import type { UserRole } from '../../../domain/types/role.types';
import { UserRoleValues } from '../../../domain/types/role.types';
import type { UserStatus } from '../../../domain/types/user-status.types';
import { UserStatusValues } from '../../../domain/types/user-status.types';
import { UserOrmEntity } from '../entities/user.orm-entity';

@Injectable()
export class UserRepository implements UserRepositoryPort {
  constructor(
    @InjectRepository(UserOrmEntity)
    private readonly ormRepository: Repository<UserOrmEntity>
  ) {}

  async findByUsername(username: string): Promise<User | null> {
    const entity = await this.ormRepository.findOne({ where: { username } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const entity = await this.ormRepository.findOne({
      where: { email: email.trim().toLowerCase() },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findById(id: string): Promise<User | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findAll(opts?: {
    status?: UserStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ users: User[]; total: number }> {
    const page = opts?.page ?? 0;
    const pageSize = opts?.pageSize ?? 25;
    const where = opts?.status ? { status: opts.status } : {};

    const [entities, total] = await this.ormRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: page * pageSize,
      take: pageSize,
    });

    return { users: entities.map((e) => this.toDomain(e)), total };
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.ormRepository.update({ id: userId }, { passwordHash });
  }

  async updateStatus(userId: string, status: UserStatus): Promise<void> {
    await this.ormRepository.update({ id: userId }, { status });
  }

  async updateRole(userId: string, role: UserRole): Promise<void> {
    await this.ormRepository.update({ id: userId }, { role });
  }

  async approveUser(userId: string, role: UserRole): Promise<void> {
    await this.ormRepository.update({ id: userId }, { role, status: 'active' });
  }

  async deleteById(userId: string): Promise<void> {
    await this.ormRepository.delete({ id: userId });
  }

  async findStaleViewerAccounts(olderThan: Date, statuses: UserStatus[]): Promise<User[]> {
    const entities = await this.ormRepository.find({
      where: { role: 'viewer', status: In(statuses), createdAt: LessThan(olderThan) },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async save(
    user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'>
  ): Promise<User> {
    const normalizedEmail = this.normalizeEmail(user.email);
    const entity = this.ormRepository.create({
      username: user.username,
      email: normalizedEmail,
      passwordHash: user.passwordHash,
      role: user.role,
      status: user.status,
    });
    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const pgErr = error as QueryFailedError & { code?: string; detail?: string };
        if (pgErr.code === '23505') {
          const detail = pgErr.detail ?? '';
          const identifier = detail.includes('(email)') ? (normalizedEmail ?? 'email') : user.username;
          throw new UserAlreadyExistsException(identifier);
        }
      }
      throw error;
    }
  }

  async deactivateAdminAtomically(userId: string): Promise<{ updated: boolean }> {
    const result = await this.ormRepository.query(
      `UPDATE users
         SET status = 'deactivated'
       WHERE id = $1
         AND (SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active') > 1`,
      [userId],
    ) as [unknown, number];
    return { updated: result[1] > 0 };
  }

  async updateAdminRoleAtomically(userId: string, role: UserRole): Promise<{ updated: boolean }> {
    const result = await this.ormRepository.query(
      `UPDATE users
         SET role = $2
       WHERE id = $1
         AND (SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active') > 1`,
      [userId, role],
    ) as [unknown, number];
    return { updated: result[1] > 0 };
  }

  async deleteAdminAtomically(userId: string): Promise<{ deleted: boolean }> {
    const result = await this.ormRepository.query(
      `DELETE FROM users
       WHERE id = $1
         AND (SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active') > 1`,
      [userId],
    ) as [unknown, number];
    return { deleted: result[1] > 0 };
  }

  /**
   * Trims and lowercases an email so `foo@example.com` and `Foo@Example.com`
   * collide against the same `UQ_users_email` constraint row (#1625).
   */
  private normalizeEmail(email: string | null): string | null {
    return email ? email.trim().toLowerCase() : null;
  }

  private toDomain(entity: UserOrmEntity): User {
    const role = UserRoleValues.includes(entity.role as UserRole)
      ? (entity.role as UserRole)
      : 'viewer';

    const status = UserStatusValues.includes(entity.status as UserStatus)
      ? (entity.status as UserStatus)
      : 'active';

    return new User(
      entity.id,
      entity.username,
      entity.email,
      entity.passwordHash,
      role,
      status,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
