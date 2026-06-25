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
import { QueryFailedError, Repository } from 'typeorm';
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
    const entity = await this.ormRepository.findOne({ where: { email } });
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

  async save(
    user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'>
  ): Promise<User> {
    const entity = this.ormRepository.create({
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      status: user.status,
    });
    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new UserAlreadyExistsException(user.username);
      }
      throw error;
    }
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
