/**
 * Create User DTO (#3456)
 *
 * Request body for `POST /users` — an admin creating an account directly,
 * typically a packer, often someone without a work email.
 *
 * `username` follows the registration rule (no `@`): the login identifier
 * routes on that character, so a username containing it could never sign in
 * by username. `email` is optional because a packer frequently has none.
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserRoleValues, type UserRole } from '@openlinker/core/users';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({ description: "The person's name as shown in lists", example: 'Anna Kowalska' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ description: 'Login (must not contain "@")', example: 'anna' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[^@]+$/, { message: 'Username must not contain "@"' })
  username!: string;

  @ApiPropertyOptional({ description: 'Email address (optional)', example: 'anna@example.com' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    // An empty field means "no email", not an invalid one.
    return trimmed === '' ? undefined : trimmed;
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'Role to assign', enum: UserRoleValues, example: 'packer' })
  @IsIn(UserRoleValues)
  role!: UserRole;
}
