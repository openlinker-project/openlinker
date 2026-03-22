/**
 * User Repository Port
 *
 * Defines the contract for user persistence operations. Implemented by
 * UserRepository in the infrastructure layer.
 *
 * @module libs/core/src/users/domain/ports
 */
import { User } from '../entities/user.entity';

export interface UserRepositoryPort {
  findByUsername(username: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  save(user: Pick<User, 'username' | 'email' | 'passwordHash'>): Promise<User>;
}
