/**
 * Login DTO
 *
 * Request body for POST /auth/login. Validated by the global ValidationPipe.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Username', example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: 'Password', example: 'secret' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
