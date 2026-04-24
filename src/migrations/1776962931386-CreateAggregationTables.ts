import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAggregationTables1776962931386 implements MigrationInterface {
  name = 'CreateAggregationTables1776962931386';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_groups" (
        "id"               uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "canonical_title"  character varying NOT NULL,
        "category"         character varying NOT NULL,
        "resolution_date"  TIMESTAMPTZ,
        "status"           character varying NOT NULL DEFAULT 'open',
        "matched_at"       TIMESTAMPTZ,
        "match_score"      double precision,
        "created_at"       TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_market_groups" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "markets" (
        "id"               uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "match_group_id"   uuid,
        "venue_id"         character varying NOT NULL,
        "venue_market_id"  character varying NOT NULL,
        "title"            character varying NOT NULL,
        "category"         character varying NOT NULL,
        "engine"           character varying NOT NULL,
        "resolution_date"  TIMESTAMPTZ,
        "status"           character varying NOT NULL DEFAULT 'open',
        "volume24h"        double precision  NOT NULL DEFAULT 0,
        "liquidity"        double precision  NOT NULL DEFAULT 0,
        "raw_data"         jsonb             NOT NULL,
        "created_at"       TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_markets"             PRIMARY KEY ("id"),
        CONSTRAINT "UQ_markets_venue"       UNIQUE ("venue_id", "venue_market_id"),
        CONSTRAINT "FK_markets_match_group" FOREIGN KEY ("match_group_id")
          REFERENCES "market_groups" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_markets_match_group_id" ON "markets" ("match_group_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_markets_status"          ON "markets" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_markets_category"        ON "markets" ("category")`);

    await queryRunner.query(`
      CREATE TABLE "match_review_queue" (
        "id"           uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "market_id_a"  character varying NOT NULL,
        "market_id_b"  character varying NOT NULL,
        "title_a"      character varying NOT NULL,
        "title_b"      character varying NOT NULL,
        "score"        double precision  NOT NULL,
        "status"       character varying NOT NULL DEFAULT 'pending',
        "reviewed_at"  TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_review_queue" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "match_review_queue"`);
    await queryRunner.query(`DROP INDEX "IDX_markets_category"`);
    await queryRunner.query(`DROP INDEX "IDX_markets_status"`);
    await queryRunner.query(`DROP INDEX "IDX_markets_match_group_id"`);
    await queryRunner.query(`DROP TABLE "markets"`);
    await queryRunner.query(`DROP TABLE "market_groups"`);
  }
}
