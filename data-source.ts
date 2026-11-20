import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Submission } from './src/submissions/entities/submission.entity.js';

// This is a separate entry point from app.module.ts's TypeOrmModule config.
// NestJS's module handles the app's runtime connection; the TypeORM CLI
// (migration:generate / migration:run / migration:revert) needs its own
// plain DataSource to connect to the DB independent of the Nest app.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'code_exec_engine',
  entities: [Submission],
  migrations: ['migrations/*.ts'],
  // synchronize is ALWAYS false here. Migrations are now the only way
  // schema changes reach the database — see Day 2 notes in README.
  synchronize: false,
});
