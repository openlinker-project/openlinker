/**
 * UserResponseDto Unit Tests
 *
 * Tests the fromDomain() factory method including role and permissions
 * derivation from the User domain entity.
 *
 * @module apps/api/src/auth/dto
 */
import { User, ROLE_PERMISSIONS, PermissionValues } from '@openlinker/core/users';
import { UserResponseDto } from './user-response.dto';

describe('UserResponseDto', () => {
  describe('fromDomain', () => {
    it('should map basic user fields correctly', () => {
      const user = new User('id-1', 'testuser', 'test@example.com', 'hash', 'admin', new Date(), new Date());

      const dto = UserResponseDto.fromDomain(user);

      expect(dto.id).toBe('id-1');
      expect(dto.username).toBe('testuser');
      expect(dto.email).toBe('test@example.com');
    });

    it('should include role in the response', () => {
      const user = new User('id-1', 'testuser', null, 'hash', 'viewer', new Date(), new Date());

      const dto = UserResponseDto.fromDomain(user);

      expect(dto.role).toBe('viewer');
    });

    it('should derive admin permissions correctly', () => {
      const user = new User('id-1', 'admin', null, 'hash', 'admin', new Date(), new Date());

      const dto = UserResponseDto.fromDomain(user);

      expect(dto.permissions).toEqual([...PermissionValues]);
      expect(dto.permissions).toEqual([...ROLE_PERMISSIONS['admin']]);
    });

    it('should derive viewer permissions correctly', () => {
      const user = new User('id-1', 'viewer', null, 'hash', 'viewer', new Date(), new Date());

      const dto = UserResponseDto.fromDomain(user);

      expect(dto.permissions).toEqual([...ROLE_PERMISSIONS['viewer']]);
      expect(dto.permissions).toContain('connections:read');
      expect(dto.permissions).not.toContain('connections:write');
    });

    it('should not expose passwordHash', () => {
      const user = new User('id-1', 'testuser', null, 'secret-hash', 'admin', new Date(), new Date());

      const dto = UserResponseDto.fromDomain(user);

      expect(dto).not.toHaveProperty('passwordHash');
    });
  });
});
