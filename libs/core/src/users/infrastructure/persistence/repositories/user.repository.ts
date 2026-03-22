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
import { Repository } from 'typeorm';
import { User } from '../../../domain/entities/user.entity';
import { UserRepositoryPort } from '../../../domain/ports/user-repository.port';
import { UserOrmEntity } from '../entities/user.orm-entity';

@Injectable()
export class UserRepository implements UserRepositoryPort {
  constructor(
    @InjectRepository(UserOrmEntity)
    private readonly ormRepository: Repository<UserOrmEntity>,
  ) {}

  async findByUsername(username: string): Promise<User | null> {
    const entity = await this.ormRepository.findOne({ where: { username } });
    return entity ? this.toDomain(entity) : null;
  }

  async findById(id: string): Promise<User | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async save(user: Pick<User, 'username' | 'email' | 'passwordHash'>): Promise<User> {
    const entity = this.ormRepository.create({
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  private toDomain(entity: UserOrmEntity): User {
    return new User(
      entity.id,
      entity.username,
      entity.email,
      entity.passwordHash,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
