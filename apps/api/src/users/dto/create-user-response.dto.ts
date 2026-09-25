/**
 * Create User Response DTO (#3456)
 *
 * Response body for `POST /users`. `temporaryPassword` exists ONLY here: it is
 * generated server-side, stored solely as a bcrypt hash, never logged, and no
 * later response can return it. The admin hands it to the person, who must
 * replace it at first sign-in (`mustChangePassword`).
 *
 * @module apps/api/src/users/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserResponseDto {
  @ApiProperty({ description: 'The new user id' })
  id!: string;

  @ApiProperty({
    description:
      'One-time password, shown only in this response. The account must set a new ' +
      'password at first sign-in; until then every other route answers 403 ' +
      'PASSWORD_CHANGE_REQUIRED.',
  })
  temporaryPassword!: string;
}
