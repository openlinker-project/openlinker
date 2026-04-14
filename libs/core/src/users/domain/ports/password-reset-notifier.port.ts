/**
 * Password Reset Notifier Port
 *
 * Delivery contract for password reset instructions (link). Implementations
 * may log to console (dev), send email (prod), or push to a queue.
 *
 * @module libs/core/src/users/domain/ports
 */
import { User } from '../entities/user.entity';

export interface PasswordResetNotifierPort {
  notifyResetRequested(user: User, rawToken: string): Promise<void>;
}
