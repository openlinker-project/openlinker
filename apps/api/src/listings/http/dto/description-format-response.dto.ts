/**
 * Description Format Response DTO (ADR-046)
 *
 * The wire shape of a destination's description contract. The frontend composes
 * its editor from this - which marks exist, which heading levels, whether a link
 * control renders, which tag bold serialises to, the byte cap - so this DTO is
 * the seam that keeps destination knowledge out of `apps/web`.
 *
 * Mirrors the core `DescriptionFormat` field for field. It is a plain value
 * type with no behaviour, which is what makes crossing the HTTP boundary cheap;
 * changing it is a coordinated change and the ADR says so.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  DescriptionFormatSourceValues,
  type DescriptionFormatSource,
  type DescriptionFormatView,
} from '@openlinker/core/listings';

export class DescriptionRewriteResponseDto {
  @ApiProperty({ description: 'Tag the rewrite applies to', example: 'strong' })
  from!: string;

  @ApiProperty({
    description:
      'rename emits `to` instead; unwrap drops the tag keeping its text; split-block substitutes a paragraph break',
    enum: ['rename', 'unwrap', 'split-block'],
  })
  action!: 'rename' | 'unwrap' | 'split-block';

  @ApiPropertyOptional({ description: 'Target tag for a rename', example: 'b' })
  to?: string;
}

export class DescriptionFormatResponseDto {
  @ApiProperty({ enum: ['html', 'plain-text'] })
  shape!: 'html' | 'plain-text';

  @ApiProperty({ type: [String], example: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'] })
  allowedTags!: string[];

  @ApiProperty({
    description: 'Allowed attributes per tag. An absent tag means no attributes at all.',
    example: { a: ['href'] },
  })
  allowedAttributes!: Record<string, string[]>;

  @ApiPropertyOptional({
    description:
      'Parent -> allowed children, plus the `root` key. Null for a flat allowlist with no context rules. An empty array means the element accepts text only.',
    example: { root: ['h1', 'h2', 'p'], p: ['b'], h1: [] },
    nullable: true,
  })
  contentModel!: Record<string, string[]> | null;

  @ApiProperty({ type: [DescriptionRewriteResponseDto] })
  rewrites!: DescriptionRewriteResponseDto[];

  @ApiProperty({ description: 'Payload must open with a block-level element' })
  requiresBlockOpener!: boolean;

  @ApiProperty({ description: 'Void elements must be written self-closing (`<br/>`)' })
  selfClosingVoids!: boolean;

  @ApiPropertyOptional({ description: 'Hard cap in UTF-8 bytes; null when unbounded', nullable: true })
  maxBytes!: number | null;

  @ApiProperty({
    description:
      'False when the destination declared no format and this is the conservative fallback. The UI must say so rather than presenting the subset as authoritative.',
  })
  declared!: boolean;

  @ApiPropertyOptional({
    description: 'Which capability answered. Null when no publishing capability resolved.',
    enum: DescriptionFormatSourceValues,
    nullable: true,
  })
  resolvedVia!: DescriptionFormatSource | null;

  static fromDomain(view: DescriptionFormatView): DescriptionFormatResponseDto {
    const { format } = view;
    return {
      shape: format.shape,
      allowedTags: [...format.allowedTags],
      // Normalised rather than passed through: the frontend reads these with
      // plain property access, and `undefined` vs `{}` vs a missing key would
      // otherwise be three shapes for the same fact.
      allowedAttributes: Object.fromEntries(
        Object.entries(format.allowedAttributes ?? {}).map(([tag, attrs]) => [tag, [...attrs]]),
      ),
      contentModel:
        format.contentModel == null
          ? null
          : Object.fromEntries(
              Object.entries(format.contentModel).map(([parent, kids]) => [parent, [...kids]]),
            ),
      rewrites: (format.rewrites ?? []).map((rewrite) => ({
        from: rewrite.from,
        action: rewrite.action,
        ...(rewrite.action === 'rename' ? { to: rewrite.to } : {}),
      })),
      requiresBlockOpener: format.requiresBlockOpener === true,
      selfClosingVoids: format.selfClosingVoids === true,
      maxBytes: format.maxBytes ?? null,
      declared: view.declared,
      resolvedVia: view.resolvedVia,
    };
  }
}
