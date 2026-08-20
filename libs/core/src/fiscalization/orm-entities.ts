/**
 * Fiscalization ORM Entities Sub-barrel (host-only)
 *
 * TypeORM-decorated entities for the fiscalization context. Kept OFF the main
 * `@openlinker/core/fiscalization` barrel (#594) because ORM entities are
 * infrastructure detail - exposing them there would couple every plugin that
 * imports the capability contract to TypeORM.
 *
 * Consumed only by host-side integration-test fixtures. Plugin packages and core
 * port files are ESLint-blocked from importing any `orm-entities` sub-barrel.
 *
 * @module libs/core/src/fiscalization
 */
export { FiscalRegistrationRecordOrmEntity } from './infrastructure/persistence/entities/fiscal-registration-record.orm-entity';
