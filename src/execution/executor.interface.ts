import { ExecutionRequest, ExecutionResult } from './execution.types.js';

/**
 * The seam between "the worker" and "how code actually runs".
 *
 * The worker doesn't care whether code runs in a Docker container, a
 * microVM (Firecracker), or a local subprocess — it just calls execute().
 * That means we can swap the sandbox strategy later without touching
 * queue logic, and we can inject a fake in tests.
 *
 * Implementations MUST NOT throw for user-code failures (a syntax error is
 * a normal ExecutionResult with outcome=ERROR, not an exception). Throwing
 * is reserved for infrastructure failures.
 */
export abstract class CodeExecutor {
  abstract execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
