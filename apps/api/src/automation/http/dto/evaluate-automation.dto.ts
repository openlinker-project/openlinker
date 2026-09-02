/**
 * Automation Dry-Run Request DTO (#2363, Wave-2 spec §5.6a)
 *
 * Exactly one of `ruleId` / `rule`, enforced by a validator rather than left to
 * the service: a body carrying both would make the endpoint silently pick one,
 * and a body carrying neither has no subject at all.
 *
 * The `rule` (draft) arm is the point of the endpoint. §5.6(a) exists so an
 * operator can test a rule BEFORE arming it; a preview available only after
 * saving would require them to save a money rule to find out what it does, which
 * is the gate inverted.
 *
 * @module apps/api/src/automation/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

import { AutomationRuleDefinitionDto } from './automation-rule.dto';

function ExactlyOneSubject(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'exactlyOneAutomationSubject',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as EvaluateAutomationDto;
          const hasId = typeof dto.ruleId === 'string' && dto.ruleId.length > 0;
          const hasDraft = dto.rule !== undefined && dto.rule !== null;
          return hasId !== hasDraft;
        },
        defaultMessage(): string {
          return 'Provide exactly one of "ruleId" (preview a saved rule) or "rule" (preview a draft).';
        },
      },
    });
  };
}

export class EvaluateAutomationDto {
  @ApiProperty({
    description:
      'The order to evaluate against. Its own facts are the subject; nothing about it is written.',
  })
  @IsString()
  @IsNotEmpty()
  // The cross-field check hangs on `orderId`, not on `ruleId`, and that is not
  // arbitrary: `@IsOptional()` short-circuits EVERY validator on the property it
  // decorates, so a check placed on the optional `ruleId` never runs for the
  // "neither was supplied" case — which is precisely the case it exists to catch.
  // `orderId` is required, so its validators always run.
  @ExactlyOneSubject()
  orderId!: string;

  @ApiPropertyOptional({ description: 'Preview a saved rule. Mutually exclusive with `rule`.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ruleId?: string;

  @ApiPropertyOptional({
    type: AutomationRuleDefinitionDto,
    description: 'Preview an unsaved draft. Mutually exclusive with `ruleId`.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationRuleDefinitionDto)
  rule?: AutomationRuleDefinitionDto;
}
