import { SubmissionLanguage } from '../submissions/entities/submission.entity.js';

export interface LanguageSpec {
  /** Pre-built image. Built once (see docker/ dir), never per-submission. */
  image: string;
  /**
   * Shell command run inside the container. Each one decodes the source
   * from the $CEE_SRC env var (base64, set by DockerExecutor) into
   * /sandbox, then runs it.
   *
   * WHY NOT WRITE THE FILE BEFORE STARTING THE CONTAINER (e.g. via
   * putArchive)? Because /sandbox lives on a tmpfs mount, and tmpfs mounts
   * are only established once the container's mount namespace exists —
   * which happens at start, not at create. A write attempted before start
   * either fails outright (if the rootfs is read-only, as ours is) or, on
   * some storage drivers, would silently get shadowed the moment the
   * tmpfs mounts over it at start. Passing the source as an env var and
   * decoding it as the first step of the container's own command sidesteps
   * the whole timing problem: the write happens from inside the already-
   * running container, onto the already-mounted tmpfs.
   *
   * Base64 (not raw text) avoids any shell-quoting/injection risk from
   * arbitrary user code containing quotes, backticks, `$(...)`, etc. —
   * the env var's value is never interpreted as shell syntax, only
   * decoded as data.
   */
  command: string[];
}

/**
 * Single source of truth for how each language runs.
 *
 * Adding a language = add an entry here + add it to the SubmissionLanguage
 * enum (which requires a migration, since it's a Postgres enum) + build the
 * image. Nothing else in the codebase needs to change — that's the point of
 * keeping this table separate from the executor logic.
 */
export const LANGUAGE_SPECS: Record<SubmissionLanguage, LanguageSpec> = {
  [SubmissionLanguage.PYTHON]: {
    image: 'cee-python:latest',
        command: [
      'sh',
      '-c',
      'echo "$CEE_SRC" | base64 -d > /sandbox/main.py && ' +
        'echo "$CEE_IN" | base64 -d | python3 /sandbox/main.py',
    ],
  },
  [SubmissionLanguage.JAVASCRIPT]: {
    image: 'cee-node:latest',
        command: [
      'sh',
      '-c',
      'echo "$CEE_SRC" | base64 -d > /sandbox/main.js && ' +
        'echo "$CEE_IN" | base64 -d | node /sandbox/main.js',
    ],
  },
  [SubmissionLanguage.CPP]: {
    image: 'cee-cpp:latest',
    // Compiles AND runs from /sandbox — the tmpfs there is mounted with
    // exec allowed specifically so the compiled binary can run (see
    // DockerExecutor's Tmpfs config).
        command: [
      'sh',
      '-c',
      'echo "$CEE_SRC" | base64 -d > /sandbox/main.cpp && ' +
        'g++ -O2 -std=c++17 /sandbox/main.cpp -o /sandbox/a.out 2>&1 && ' +
        'echo "$CEE_IN" | base64 -d | /sandbox/a.out',
    ],
  },
};

