import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { SubmissionsProcessor } from './submissions.processor.js';
import {
  Submission,
  SubmissionLanguage,
  SubmissionStatus,
} from './entities/submission.entity.js';
import { CodeExecutor } from '../execution/executor.interface.js';
import {
  ExecutionOutcome,
  ExecutionResult,
} from '../execution/execution.types.js';
import type { ExecutionJobData } from '../queue/queue.constants.js';

function makeJob(
  submissionId = 'sub-1',
  attemptsMade = 0,
  attempts = 3,
): Job<ExecutionJobData> {
  return {
    data: { submissionId },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<ExecutionJobData>;
}

function makeResult(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    outcome: ExecutionOutcome.SUCCESS,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 10,
    ...over,
  };
}

describe('SubmissionsProcessor', () => {
  let processor: SubmissionsProcessor;
  let repo: { findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let executor: { execute: ReturnType<typeof vi.fn> };

  const pendingSubmission: Partial<Submission> = {
    id: 'sub-1',
    code: 'print(1)',
    language: SubmissionLanguage.PYTHON,
    stdin: null,
    status: SubmissionStatus.PENDING,
  };

  beforeEach(async () => {
    repo = { findOne: vi.fn(), update: vi.fn().mockResolvedValue({}) };
    executor = { execute: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubmissionsProcessor,
        { provide: getRepositoryToken(Submission), useValue: repo },
        { provide: CodeExecutor, useValue: executor },
      ],
    }).compile();

    processor = moduleRef.get(SubmissionsProcessor);
  });

  it('marks the submission RUNNING before executing', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(makeResult());

    await processor.process(makeJob());

    expect(repo.update).toHaveBeenCalledWith('sub-1', {
      status: SubmissionStatus.RUNNING,
    });
  });

  it('maps SUCCESS to COMPLETED and stores stdout', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(
      makeResult({ stdout: 'hello\n', exitCode: 0 }),
    );

    await processor.process(makeJob());

    expect(repo.update).toHaveBeenLastCalledWith('sub-1', {
      status: SubmissionStatus.COMPLETED,
      result: 'hello\n',
      errorMessage: null,
      passed: null,
    });
  });

  it('maps a non-zero exit to FAILED and keeps stderr', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(
      makeResult({
        outcome: ExecutionOutcome.ERROR,
        stderr: 'SyntaxError',
        exitCode: 1,
      }),
    );

    await processor.process(makeJob());

    expect(repo.update).toHaveBeenLastCalledWith('sub-1', {
      status: SubmissionStatus.FAILED,
      result: '',
      errorMessage: 'SyntaxError',
      passed: null,
    });
  });

  it('maps TIMEOUT to the TIMEOUT status with an explanatory message', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(
      makeResult({ outcome: ExecutionOutcome.TIMEOUT, exitCode: null }),
    );

    await processor.process(makeJob());

    const call = repo.update.mock.calls.at(-1)!;
    expect(call[1].status).toBe(SubmissionStatus.TIMEOUT);
    expect(call[1].errorMessage).toMatch(/exceeded/i);
  });

  it('is idempotent: skips a submission already in a terminal state', async () => {
    repo.findOne.mockResolvedValue({
      ...pendingSubmission,
      status: SubmissionStatus.COMPLETED,
    });

    await processor.process(makeJob());

    // At-least-once delivery means this handler can run twice. A duplicate
    // must not re-execute or clobber the stored result.
    expect(executor.execute).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('drops the job when the submission row is gone', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('throws on infra error while retries remain, resetting to PENDING', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(
      makeResult({
        outcome: ExecutionOutcome.INTERNAL_ERROR,
        stderr: 'docker daemon unreachable',
        exitCode: null,
      }),
    );

    // attempt 1 of 3 — should hand the job back to BullMQ.
    await expect(processor.process(makeJob('sub-1', 0, 3))).rejects.toThrow(
      /daemon/,
    );
    expect(repo.update).toHaveBeenCalledWith('sub-1', {
      status: SubmissionStatus.PENDING,
    });
  });

  it('records FAILED instead of throwing once retries are exhausted', async () => {
    repo.findOne.mockResolvedValue(pendingSubmission);
    executor.execute.mockResolvedValue(
      makeResult({
        outcome: ExecutionOutcome.INTERNAL_ERROR,
        stderr: 'docker daemon unreachable',
        exitCode: null,
      }),
    );

    // Final attempt — must not throw forever, must record a real outcome.
    await processor.process(makeJob('sub-1', 2, 3));

    expect(repo.update).toHaveBeenLastCalledWith('sub-1', {
      status: SubmissionStatus.FAILED,
      result: '',
      errorMessage: 'docker daemon unreachable',
      passed: null,
    });
  });

  it('passes stdin through to the executor', async () => {
    repo.findOne.mockResolvedValue({ ...pendingSubmission, stdin: '42\n' });
    executor.execute.mockResolvedValue(makeResult());

    await processor.process(makeJob());

    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdin: '42\n' }),
    );
  });
    describe('test-case runner', () => {
    it('sets passed=true when stdout matches expectedOutput', async () => {
      repo.findOne.mockResolvedValue({ ...pendingSubmission, expectedOutput: '42' });
      executor.execute.mockResolvedValue(makeResult({ stdout: '42\n' }));
      await processor.process(makeJob());
      expect(repo.update.mock.calls.at(-1)![1].passed).toBe(true);
    });

    it('sets passed=false on mismatch', async () => {
      repo.findOne.mockResolvedValue({ ...pendingSubmission, expectedOutput: '42' });
      executor.execute.mockResolvedValue(makeResult({ stdout: '43\n' }));
      await processor.process(makeJob());
      expect(repo.update.mock.calls.at(-1)![1].passed).toBe(false);
    });

    it('leaves passed=null when no expectedOutput', async () => {
      repo.findOne.mockResolvedValue({ ...pendingSubmission, expectedOutput: null });
      executor.execute.mockResolvedValue(makeResult({ stdout: 'x\n' }));
      await processor.process(makeJob());
      expect(repo.update.mock.calls.at(-1)![1].passed).toBeNull();
    });

    it('leaves passed=null when the program errored', async () => {
      repo.findOne.mockResolvedValue({ ...pendingSubmission, expectedOutput: '42' });
      executor.execute.mockResolvedValue(
        makeResult({ outcome: ExecutionOutcome.ERROR, stderr: 'boom', exitCode: 1 }),
      );
      await processor.process(makeJob());
      expect(repo.update.mock.calls.at(-1)![1].passed).toBeNull();
    });

    it('leaves passed=null on timeout', async () => {
      repo.findOne.mockResolvedValue({ ...pendingSubmission, expectedOutput: '42' });
      executor.execute.mockResolvedValue(
        makeResult({ outcome: ExecutionOutcome.TIMEOUT, exitCode: null }),
      );
      await processor.process(makeJob());
      expect(repo.update.mock.calls.at(-1)![1].passed).toBeNull();
    });
  });
});
