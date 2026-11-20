import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubmissionLanguage {
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
  CPP = 'cpp',
}

export enum SubmissionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

@Entity('submissions')
export class Submission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'enum', enum: SubmissionLanguage })
  language: SubmissionLanguage;

  @Index()
  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.PENDING,
  })
  status: SubmissionStatus;

  @Column({ type: 'text', nullable: true })
  stdin: string | null;

  @Column({ type: 'text', nullable: true, name: 'expected_output' })
  expectedOutput: string | null;

  // Populated once the worker finishes running the submission (Week 2)
  @Column({ type: 'text', nullable: true })
  result: string | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

    // null = expectedOutput nahi diya, ya program cleanly complete nahi hua
  @Column({ type: 'boolean', nullable: true, default: null })
  passed: boolean | null;

  // Indexed because GET /submissions always sorts by this column (see
  // submissions.service.ts findAll). Without an index, Postgres has to
  // sequential-scan + sort the whole table on every paginated request —
  // fine at 100 rows, painful at 1M.
  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
