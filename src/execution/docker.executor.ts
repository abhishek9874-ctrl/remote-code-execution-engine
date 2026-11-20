import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { Writable } from 'node:stream';
import { CodeExecutor } from './executor.interface.js';
import {
  ExecutionOutcome,
  ExecutionRequest,
  ExecutionResult,
  truncateOutput,
} from './execution.types.js';
import { LANGUAGE_SPECS } from './language-specs.js';

/** Memory ceiling per submission. */
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024; // 256MB
/** Half a CPU core. CpuQuota/CpuPeriod is the cgroup way to express this. */
const CPU_PERIOD = 100_000;
const CPU_QUOTA = 50_000;
/** Max processes/threads. This is the fork-bomb defence. */
const PIDS_LIMIT = 64;
/**
 * Writable scratch space, since the rootfs is read-only. This is where
 * source lands (decoded from $CEE_SRC) and where compiled binaries run
 * from — see language-specs.ts for why exec must stay allowed here.
 * Counts against the container's memory limit, since tmpfs is RAM-backed.
 */
const SANDBOX_TMPFS_BYTES = 32 * 1024 * 1024; // 32MB

@Injectable()
export class DockerExecutor extends CodeExecutor {
  private readonly logger = new Logger(DockerExecutor.name);
  private readonly docker = new Docker();

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const spec = LANGUAGE_SPECS[request.language];
    if (!spec) {
      // Defensive: the DTO enum should make this unreachable.
      return this.internalError(`No language spec for "${request.language}"`);
    }

    const startedAt = Date.now();
    let container: Docker.Container | undefined;

    try {
      container = await this.docker.createContainer({
        
        Image: spec.image,
        Cmd: spec.command,
        WorkingDir: '/sandbox',

        // The source travels as base64 in an env var, decoded by the
        // container's own command (see language-specs.ts for why this
        // replaced writing the file in via putArchive before start).
        Env: [`CEE_SRC=${Buffer.from(request.code, 'utf8').toString('base64')}`,
          `CEE_IN=${Buffer.from(request.stdin ?? '', 'utf8').toString('base64')}`,
        ],

        // Attach stdio so we can stream stdout/stderr back out.
        AttachStdout: true,
        AttachStderr: true,

        // Run as an unprivileged user. Even if code escapes the process,
        // it isn't root inside the container.
        User: 'sandbox',

        // Disable DNS lookups entirely alongside NetworkMode: none.
        NetworkDisabled: true,

        HostConfig: {
          // --- The security envelope. Each of these closes a real attack. ---

          // No network: can't exfiltrate data, can't fetch a second-stage
          // payload, can't DDoS anyone from your infrastructure.
          NetworkMode: 'none',

          // Memory cap. Without this a single submission can OOM the host.
          // MemorySwap == Memory disables swap, so the limit is real rather
          // than "spill to disk and grind the box to a halt".
          Memory: MEMORY_LIMIT_BYTES,
          MemorySwap: MEMORY_LIMIT_BYTES,

          // CPU cap: 50_000/100_000 = 0.5 cores. Stops a busy-loop from
          // starving other workers on the same host.
          CpuPeriod: CPU_PERIOD,
          CpuQuota: CPU_QUOTA,

          // Fork-bomb defence. `while true: fork()` hits this ceiling and
          // fails instead of exhausting the host's PID table.
          PidsLimit: PIDS_LIMIT,

          // Read-only root filesystem: can't modify binaries, can't persist
          // anything, can't fill the host disk.
          ReadonlyRootfs: true,

          // The one carved-out writable directory. `exec` is deliberately
          // allowed (unlike a typical hardened /tmp) because C++ compiles
          // its binary here and must then be able to run it from here too.
          // uid/gid pin ownership to the unprivileged `sandbox` user so it
          // doesn't land root:root by default.
          Tmpfs: {
            '/sandbox': `rw,exec,nosuid,uid=10001,gid=10001,mode=0755,size=${SANDBOX_TMPFS_BYTES}`,
          },

          // Drop every Linux capability. Nothing here needs CAP_NET_RAW,
          // CAP_SYS_ADMIN, or any of the rest.
          CapDrop: ['ALL'],

          // Blocks setuid binaries from escalating privileges mid-execution.
          SecurityOpt: ['no-new-privileges'],

          AutoRemove: false, // we remove explicitly in finally
        },
      });

      

      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });
      

      const { stdout, stderr } = this.collectOutput(container, stream);
      

      await container.start();

      
      // Race the container against the clock.
      const timedOut = await this.waitWithTimeout(container, request.timeoutMs);

      const durationMs = Date.now() - startedAt;

      if (timedOut) {
        return {
          outcome: ExecutionOutcome.TIMEOUT,
          stdout: truncateOutput(stdout()),
          stderr: truncateOutput(stderr()),
          exitCode: null,
          durationMs,
        };
      }

      const info = await container.inspect();
      const exitCode = info.State.ExitCode ?? null;

      // OOMKilled is reported separately from the exit code — surface it,
      // otherwise "killed at 256MB" looks like a mysterious exit 137.
      const oomKilled = info.State.OOMKilled === true;

      return {
        outcome:
          exitCode === 0 ? ExecutionOutcome.SUCCESS : ExecutionOutcome.ERROR,
        stdout: truncateOutput(stdout()),
        stderr: truncateOutput(
          oomKilled
            ? `${stderr()}\n[killed: memory limit exceeded]`
            : stderr(),
        ),
        exitCode,
        durationMs,
      };
    } catch (err) {
      this.logger.error(`Docker execution failed: ${String(err)}`);
      return this.internalError(String(err), Date.now() - startedAt);
    } finally {
      if (container) {
        // Best-effort teardown. A leaked container is a leaked resource,
        // so this must never be skipped, even on the error path.
        await container.remove({ force: true }).catch(() => undefined);
      }
    }
  }

  /**
   * Resolves true if we had to kill the container, false if it exited on
   * its own in time.
   */
  private async waitWithTimeout(
    container: Docker.Container,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    const killer = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        // SIGKILL, not SIGTERM: user code must not be able to trap the
        // signal and keep running past its budget.
        container.kill({ signal: 'SIGKILL' }).catch(() => undefined);
        resolve(true);
      }, timeoutMs);
    });

    const waiter = container.wait().then(() => false);

    const timedOut = await Promise.race([waiter, killer]);
    if (timer) clearTimeout(timer);
    return timedOut;
  }

  /**
   * Docker multiplexes stdout and stderr into one stream with an 8-byte
   * header per frame. demuxStream splits them back apart.
   */
  private collectOutput(
    container: Docker.Container,
    stream: NodeJS.ReadWriteStream,
  ): { stdout: () => string; stderr: () => string } {
    let out = '';
    let err = '';

    const outSink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        out += chunk.toString('utf8');
        cb();
      },
    });
    const errSink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        err += chunk.toString('utf8');
        cb();
      },
    });

    container.modem.demuxStream(stream, outSink, errSink);

    return { stdout: () => out, stderr: () => err };
  }

  private internalError(message: string, durationMs = 0): ExecutionResult {
    return {
      outcome: ExecutionOutcome.INTERNAL_ERROR,
      stdout: '',
      stderr: message,
      exitCode: null,
      durationMs,
    };
  }
}
