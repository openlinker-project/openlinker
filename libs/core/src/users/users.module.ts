/**
 * Users Module
 *
 * NestJS module for user persistence. Registers the UserRepository and exports
 * the USER_REPOSITORY_TOKEN so that AuthModule can inject the repository
 * without depending on the concrete class.
 *
 * @module libs/core/src/users
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOrmEntity } from './infrastructure/persistence/entities/user.orm-entity';
import { UserRepository } from './infrastructure/persistence/repositories/user.repository';

export const USER_REPOSITORY_TOKEN = Symbol('UserRepositoryPort');

@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity])],
  providers: [
    UserRepository,
    {
      provide: USER_REPOSITORY_TOKEN,
      useExisting: UserRepository,
    },
  ],
  exports: [USER_REPOSITORY_TOKEN],
})
export class UsersModule {}
