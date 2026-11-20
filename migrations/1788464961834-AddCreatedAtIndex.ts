import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedAtIndex1788464961834 implements MigrationInterface {
    name = 'AddCreatedAtIndex1788464961834'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_03790e3f068aba228d5988f8b8" ON "submissions"  ("created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_03790e3f068aba228d5988f8b8"`);
    }

}
