import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPassedColumn1792607686434 implements MigrationInterface {
    name = 'AddPassedColumn1792607686434'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "submissions" ADD "passed" boolean`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "submissions" DROP COLUMN "passed"`);
    }

}
