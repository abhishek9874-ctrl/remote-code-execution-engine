export const EXECUTION_QUEUE = 'execution';

/**
 * The job payload is deliberately just an ID, not the full submission.
 *
 * Why: the code could be 20KB, and Redis would then hold a second copy of
 * every submission. Passing the ID keeps jobs tiny and makes Postgres the
 * single source of truth — the worker re-reads current state when it picks
 * the job up, so it can never act on a stale snapshot.
 */
export interface ExecutionJobData {
  submissionId: string;
  traceContext?: Record<string, string>;
}
