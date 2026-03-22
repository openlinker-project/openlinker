/**
 * User Domain Entity
 *
 * Represents an authenticated user of the OpenLinker platform. This is a
 * pure domain entity with no framework dependencies, used by the auth module
 * for credential validation and session management.
 *
 * @module libs/core/src/users/domain/entities
 */

export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly email: string | null,
    public readonly passwordHash: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
