import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSubmissions1788464927659 implements MigrationInterface {
    name = 'InitSubmissions1788464927659'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."submissions_language_enum" AS ENUM('python', 'javascript', 'cpp')`);
        await queryRunner.query(`CREATE TYPE "public"."submissions_status_enum" AS ENUM('pending', 'running', 'completed', 'failed', 'timeout')`);
        await queryRunner.query(`CREATE TABLE "submissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" text NOT NULL, "language" "public"."submissions_language_enum" NOT NULL, "status" "public"."submissions_status_enum" NOT NULL DEFAULT 'pending', "stdin" text, "expected_output" text, "result" text, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_10b3be95b8b2fb1e482e07d706b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d4842916487f15fcca89b1a918" ON "submissions"  ("status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d4842916487f15fcca89b1a918"`);
        await queryRunner.query(`DROP TABLE "submissions"`);
        await queryRunner.query(`DROP TYPE "public"."submissions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."submissions_language_enum"`);
    }

}
