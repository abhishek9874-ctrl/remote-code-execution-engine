import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeExecutor } from './executor.interface.js';
import {
  ExecutionOutcome,
  ExecutionRequest,
  ExecutionResult,
  truncateOutput,
} from './execution.types.js';
import { SubmissionLanguage } from '../submissions/entities/submission.entity.js';

/**
 * ⚠️  NOT A SANDBOX. ⚠️
 *
 * This runs submitted code as a plain subprocess on the host, with the same
 * privileges as the API process. There is no isolation: submitted code can
 * read your files, open sockets, and spawn processes.
 *
 * It exists for ONE reason: to let you exercise the queue → worker → DB
 * pipeline on a machine without a Docker daemon. It is gated behind an
 * explicit EXECUTOR=local env var and refuses to load when NODE_ENV is
 * production.
 *
 * Never point this at untrusted input. DockerExecutor is the real one.
 */
@Injectable()
export class LocalExecutor extends CodeExecutor {
  private readonly logger = new Logger(LocalExecutor.name);

  constructor() {
    super();
    this.logger.warn(
      '⚠️  LocalExecutor active — submitted code runs UNSANDBOXED on this host. Dev only.',
    );
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = Date.now();
    let dir: string | undefined;

    try {
      dir = await mkdtemp(join(tmpdir(), 'cee-'));
      const { file, cmd, args } = this.resolve(request.language, dir);
      await writeFile(join(dir, file), request.code, 'utf8');

      return await new Promise<ExecutionResult>((resolve) => {
        const child = spawn(cmd, args, {
          cwd: dir,
          // detached lets us kill the whole process group, not just the
          // direct child — otherwise a spawned grandchild survives the kill.
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
        child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            // Negative PID = kill the process group.
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            /* already gone */
          }
          resolve({
            outcome: ExecutionOutcome.TIMEOUT,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
            exitCode: null,
            durationMs: Date.now() - startedAt,
          });
        }, request.timeoutMs);

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            outcome: ExecutionOutcome.INTERNAL_ERROR,
            stdout: '',
            stderr: String(err),
            exitCode: null,
            durationMs: Date.now() - startedAt,
          });
        });

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            outcome:
              code === 0 ? ExecutionOutcome.SUCCESS : ExecutionOutcome.ERROR,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
            exitCode: code,
            durationMs: Date.now() - startedAt,
          });
        });

        if (request.stdin) child.stdin.write(request.stdin);
        child.stdin.end();
      });
    } catch (err) {
      return {
        outcome: ExecutionOutcome.INTERNAL_ERROR,
        stdout: '',
        stderr: String(err),
        exitCode: null,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private resolve(language: SubmissionLanguage, dir: string) {
    switch (language) {
      case SubmissionLanguage.PYTHON:
        return { file: 'main.py', cmd: 'python3', args: ['main.py'] };
      case SubmissionLanguage.JAVASCRIPT:
        return { file: 'main.js', cmd: 'node', args: ['main.js'] };
      case SubmissionLanguage.CPP:
        return {
          file: 'main.cpp',
          cmd: 'sh',
          args: ['-c', `g++ -O2 -std=c++17 main.cpp -o ${dir}/a.out 2>&1 && ${dir}/a.out`],
        };
    }
  }
}
