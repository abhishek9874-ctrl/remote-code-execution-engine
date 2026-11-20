import { SubmissionLanguage } from '../submissions/entities/submission.entity.js';

/**
 * What the worker hands to an executor.
 */
export interface ExecutionRequest {
  code: string;
  language: SubmissionLanguage;
  stdin?: string | null;
  /** Hard wall-clock limit. Executor MUST kill the process past this. */
  timeoutMs: number;
}

/**
 * Why an execution ended. Maps onto SubmissionStatus in the worker.
 */
export enum ExecutionOutcome {
  /** Ran to completion, exit code 0. */
  SUCCESS = 'success',
  /** Ran to completion, non-zero exit code (compile error, runtime error, etc). */
  ERROR = 'error',
  /** Killed because it exceeded timeoutMs. */
  TIMEOUT = 'timeout',
  /** The sandbox itself failed (image missing, daemon down). NOT the user's fault. */
  INTERNAL_ERROR = 'internal_error',
}

export interface ExecutionResult {
  outcome: ExecutionOutcome;
  stdout: string;
  stderr: string;
  /** null when the process was killed rather than exiting on its own. */
  exitCode: number | null;
  /** Wall-clock duration, useful for the metrics work in Week 4. */
  durationMs: number;
}

/**
 * Output caps. A submission that prints in an infinite loop would otherwise
 * stream gigabytes into memory before the timeout ever fires.
 */
export const MAX_OUTPUT_BYTES = 64 * 1024; // 64kb per stream

export function truncateOutput(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return text;
  return (
    Buffer.from(text, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') +
    '\n...[output truncated]'
  );
}
