import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryMappingsTable1779000000000 implements MigrationInterface {
  name = 'AddCategoryMappingsTable1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "category_mappings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connection_id" uuid NOT NULL,
        "prestashop_category_id" varchar(100) NOT NULL,
        "allegro_category_id" varchar(100) NOT NULL,
        "allegro_category_name" varchar(500) NOT NULL,
        "allegro_category_path" varchar(1000),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_mappings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_category_mappings_connection" FOREIGN KEY ("connection_id")
          REFERENCES "connections"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_category_mappings_connection_prestashop" UNIQUE ("connection_id", "prestashop_category_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_category_mappings_connection_id"
        ON "category_mappings" ("connection_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "category_mappings"`);
  }
}
