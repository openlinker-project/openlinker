import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllegroCategoryCacheTable1779000000001 implements MigrationInterface {
  name = 'AddAllegroCategoryCacheTable1779000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "allegro_category_cache" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connection_id" uuid NOT NULL,
        "allegro_category_id" varchar(100) NOT NULL,
        "name" varchar(500) NOT NULL,
        "parent_id" varchar(100),
        "leaf" boolean NOT NULL DEFAULT false,
        "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_allegro_category_cache" PRIMARY KEY ("id"),
        CONSTRAINT "FK_allegro_category_cache_connection" FOREIGN KEY ("connection_id")
          REFERENCES "connections"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_allegro_category_cache_connection_category" UNIQUE ("connection_id", "allegro_category_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_allegro_category_cache_connection_parent"
        ON "allegro_category_cache" ("connection_id", "parent_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "allegro_category_cache"`);
  }
}
