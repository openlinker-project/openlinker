/**
 * Stock View Response DTO
 *
 * Response shape for `GET /inventory/stock-view?productId=` (#3621). Dates are
 * ISO 8601 strings. Every figure OpenLinker may not know is `number | null`,
 * and `null` is never a zero: a client must say "unknown" / "not seen yet"
 * rather than render a quantity.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

const PROVENANCE = ['computed', 'authority', 'unknown'] as const;

export class StockViewThresholdDto {
  @ApiProperty({ description: 'Hours a stock observation may age before it is flagged stale.' })
  hours!: number;

  @ApiProperty({ description: 'The same threshold in milliseconds.' })
  ms!: number;

  @ApiProperty({
    enum: ['setting', 'env', 'default'],
    description: 'Which rung produced the value (settings page, env var, built-in default).',
  })
  source!: 'setting' | 'env' | 'default';
}

export class StockViewPositionDto {
  @ApiProperty({ type: String, nullable: true })
  locationId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null when the location has no name on record.' })
  locationName!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Owning master; null or `legacy` = not backfilled.' })
  sourceConnectionId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null when the connection is gone or unnamed.' })
  sourceConnectionName!: string | null;

  @ApiProperty({ description: 'The master no longer reports this position. Excluded from every total.' })
  isStale!: boolean;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty({ description: 'The MASTER\'s own reserved units (already taken out of availableQuantity).' })
  reservedQuantity!: number;

  @ApiProperty({ description: 'When this position was last written by a stock sync (ISO 8601).' })
  updatedAt!: string;
}

export class StockViewHoldDto {
  @ApiProperty({ description: 'Internal order id the units are promised to.' })
  orderRecordId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Source order number; null when unresolved.' })
  orderNumber!: string | null;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    enum: ['published', 'diagnostic'],
    description: '`published` reduces available to promise; `diagnostic` is recorded and restricts nothing.',
  })
  atpEffect!: 'published' | 'diagnostic';

  @ApiProperty({ description: 'ISO 8601.' })
  expiresAt!: string;
}

export class StockViewChannelRuleDto {
  @ApiProperty({ description: 'Units held back on this connection (stockSafetyBuffer).' })
  stockSafetyBuffer!: number;

  @ApiProperty({ description: 'A quantity strictly below this publishes as 0 (stockZeroThreshold); 0 = off.' })
  stockZeroThreshold!: number;
}

export class StockViewWillPublishDto {
  @ApiProperty({ type: Number, nullable: true, description: 'null when available to promise is unknown - nothing is sent.' })
  quantity!: number | null;

  @ApiProperty({ enum: PROVENANCE })
  provenance!: 'computed' | 'authority' | 'unknown';
}

export class StockViewChannelShowsDto {
  @ApiProperty({ type: Number, nullable: true, description: 'What the marketplace last reported; null = not seen yet, never 0.' })
  quantity!: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'When that was read (ISO 8601); null when never.' })
  observedAt!: string | null;
}

export class StockViewChannelDto {
  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  connectionName!: string;

  @ApiProperty()
  platformType!: string;

  @ApiProperty({ type: StockViewChannelRuleDto, nullable: true, description: 'null when the connection\'s rule could not be read.' })
  rule!: StockViewChannelRuleDto | null;

  @ApiProperty({ type: StockViewWillPublishDto })
  willPublish!: StockViewWillPublishDto;

  @ApiProperty({ type: StockViewChannelShowsDto })
  channelShows!: StockViewChannelShowsDto;
}

export class StockViewVariantDto {
  @ApiProperty()
  productVariantId!: string;

  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Variant attributes (size, colour...).' })
  attributes!: Record<string, string>;

  @ApiProperty({ description: 'Sum of the master\'s stock over LIVE positions.' })
  masterAvailable!: number;

  @ApiProperty({ description: 'Sum of the master\'s own reserved units over LIVE positions.' })
  masterReserved!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'GLOBAL-scope promise, no channel buffer. null <=> provenance unknown.' })
  availableToPromise!: number | null;

  @ApiProperty({ enum: PROVENANCE })
  provenance!: 'computed' | 'authority' | 'unknown';

  @ApiProperty({ type: String, nullable: true, description: 'Newest stock write across live positions (ISO 8601).' })
  observedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  stalenessMs!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  olHeldNotReflected!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Holds that reduce the promise. null = unknown.' })
  heldCounted!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Holds recorded but not counted. null = unknown.' })
  heldRecordedOnly!: number | null;

  @ApiProperty({ description: 'Live positions behind the variant; more than 1 = several locations/masters.' })
  livePositionCount!: number;

  @ApiProperty({ description: 'The newest observation is older than the stale-sync threshold.' })
  isStaleSync!: boolean;

  @ApiProperty({ type: [StockViewPositionDto], description: 'Every position, stale ones flagged.' })
  positions!: StockViewPositionDto[];

  @ApiProperty({
    type: [StockViewHoldDto],
    nullable: true,
    description: 'Newest live holds (max 20); null = could not be read (not "no holds").',
  })
  holds!: StockViewHoldDto[] | null;

  @ApiProperty({ type: [StockViewChannelDto], description: 'Channels this variant is published on.' })
  channels!: StockViewChannelDto[];
}

export class StockViewResponseDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ type: String, nullable: true })
  productSku!: string | null;

  @ApiProperty({ type: StockViewThresholdDto })
  staleSyncThreshold!: StockViewThresholdDto;

  @ApiProperty({
    enum: ['ok', 'partial', 'unavailable'],
    description:
      '`partial`: some channel could not be read and is missing from channels[]. `unavailable`: channels could not be listed at all - an empty channels[] then does NOT mean "not published anywhere".',
  })
  channelsStatus!: 'ok' | 'partial' | 'unavailable';

  @ApiProperty({ type: [StockViewVariantDto] })
  variants!: StockViewVariantDto[];

  @ApiProperty({ description: 'ISO 8601.' })
  generatedAt!: string;
}
