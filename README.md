# Code Execution Engine — Week 1-2

Sandboxed code execution engine: submit code → queue → isolated worker → result.

## Stack
- NestJS 12 (ESM/TypeScript)
- TypeORM + PostgreSQL
- class-validator for request validation
- Vitest for testing

## What's built so far
- `submissions` table/entity (id, code, language, status, stdin, expected_output, result, timestamps)
- `POST /submissions` — create a submission (validated: language whitelist, 20k char code limit)
- `GET /submissions/:id` — fetch one submission
- `GET /submissions?page=1&limit=20` — paginated list
- **Real versioned migrations** (Day 2) — schema changes go through `migrations/`, not `synchronize: true`
- Indexes on `status` and `created_at` (the latter added specifically because the list endpoint
  sorts by it — verified with `EXPLAIN` that Postgres uses an Index Scan, not a sequential scan)
- **Rate limiting** (Day 3) — global 30 req/min/IP default, stricter 10 req/min/IP on `POST /submissions`
  specifically (it's the expensive endpoint that'll trigger real container execution in Week 2)
- **Security headers** via `helmet` (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- **Body size cap** — 100kb limit at the Express parser level, before validation even runs
- **Whitespace-only code rejected** — closed a gap where `" "` passed the old `@MinLength(1)` check
- 18 passing unit tests (service + controller + DTO edge cases — mocked repository, no DB needed)

## Running locally

1. Start Postgres:
   ```bash
   docker compose up -d
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy env file:
   ```bash
   cp .env.example .env
   ```

4. Run migrations (schema is NOT auto-synced anymore — this is the only way tables get created):
   ```bash
   npm run migration:run
   ```

5. Run in dev mode:
   ```bash
   npm run start:dev
   ```

   The app boots on `http://localhost:3000`.

6. Run tests:
   ```bash
   npm run test
   ```

## Migration workflow (Day 2)

```bash
# After changing an entity, generate a migration by diffing against the live DB:
npm run migration:generate -- migrations/YourMigrationName

# Apply pending migrations:
npm run migration:run

# Roll back the most recent migration:
npm run migration:revert
```

Two migrations exist so far:
1. `InitSubmissions` — creates the `submissions` table, enums, and the `status` index
2. `AddCreatedAtIndex` — adds an index on `created_at` (our pagination sort column)

**Why `created_at` got its own migration instead of being in the first one:** it's a good example
of the real workflow — you don't always get every index right on the first pass. You notice a slow
query pattern (sorting on an unindexed column), add the index to the entity, and generate a
follow-up migration. That's normal, not a mistake to hide.

## Indexing decisions (Day 2 notes)

- **`status`**: not currently queried by directly, but will be once Week 2's worker needs to pull
  `pending` jobs efficiently, and once an admin/filter view exists.
- **`created_at`**: indexed because `findAll()` always does `ORDER BY created_at DESC` for
  pagination. Confirmed via `EXPLAIN` that this changed the query plan from a sequential scan to
  an `Index Scan Backward` — meaningful once the table has real volume.
- **Not indexed**: `code`, `result`, `stdin` — large text fields nobody filters or sorts by. Indexing
  them would slow down writes for zero read benefit. Every index has a write-cost trade-off; only
  add one when a real query pattern needs it.

## Hardening decisions (Day 3 notes)

- **Rate limiting is a fixed-window algorithm** (via `@nestjs/throttler`): N requests per fixed
  TTL window, tracked per client IP. It resets the whole window at once (vs. a sliding/token-bucket
  approach that smooths bursts) — simpler to reason about, good enough at this stage. Verified live:
  10 rapid requests to `POST /submissions` succeed, the 11th returns `429`.
- **Why `POST /submissions` gets its own stricter limit**: it's the only endpoint that does real
  work (and will trigger actual Docker container execution once Week 2's worker exists) — reads
  (`GET`) are cheap and share the looser global limit.
- **Body size cap sits below validation, not instead of it.** The DTO's `MaxLength(20_000)` on
  `code` only runs after Express has already parsed the whole request body into memory. The
  100kb Express-level cap stops the expensive parsing work from happening at all for a hostile
  oversized payload — verified: a 200KB body gets `413` before it ever reaches the DTO.
- **`@Matches(/\S/)` vs `@MinLength(1)`**: `MinLength(1)` treats a single space as valid ("
  " has length 1). `\S` requires at least one non-whitespace character anywhere in the string,
  which is what "non-empty code" actually means. Small gap, but the kind of thing that's obvious
  once pointed out and invisible until then — a good example to have ready if an interviewer asks
  "walk me through a validation bug you found and fixed."

## Try it

```bash
# Create a submission
curl -X POST http://localhost:3000/submissions \
  -H "Content-Type: application/json" \
  -d '{"code": "print(\"hello world\")", "language": "python"}'

# List submissions
curl http://localhost:3000/submissions

# Get one by id (use the id returned from the POST above)
curl http://localhost:3000/submissions/<id>
```

## Next up (Week 2)
Wire `SubmissionsService.create()` to push the new submission's id onto a
Redis/BullMQ queue, and build the worker process that picks it up and runs
the code inside a sandboxed Docker container.

---

# Week 2 — Queue + Worker + Sandbox

## Architecture

```
POST /submissions
   │
   ├─→ Postgres INSERT (status: pending)          ← committed first
   └─→ BullMQ job { submissionId }                ← only the ID travels
                │
                ▼
        SubmissionsProcessor (concurrency 4)
                │  status: running
                ▼
           CodeExecutor  ──→ DockerExecutor (sandboxed)
                          └→ LocalExecutor  (dev only, no sandbox)
                │
                ▼
        Postgres UPDATE (completed | failed | timeout)
```

## Design decisions

**The job payload carries only `submissionId`, not the code.** Code can be 20KB;
duplicating it into Redis doubles storage and creates two sources of truth. The worker
re-reads the row when it picks the job up, so it can never act on a stale snapshot.

**Postgres is written before the job is enqueued.** Reversed, a fast worker could look
up a row that hasn't committed yet. This still isn't atomic — if Redis is unreachable
the row stays `pending` with no job. The textbook fix is the transactional outbox
pattern; the cheap fix is a periodic sweep for stale `pending` rows. Currently logged
loudly rather than silently swallowed.

**The worker is idempotent.** BullMQ guarantees *at-least-once* delivery, not
exactly-once — a worker that crashes after executing but before acking will see the
same job again. `process()` therefore skips any submission already in a terminal state
(`completed`/`failed`/`timeout`) instead of re-running it and clobbering the result.
Note it does *not* skip `running`: a job interrupted mid-execution should be retried,
which is exactly what happens on crash recovery.

**User-code failure ≠ job failure.** A `ValueError` in submitted code is a normal
`ExecutionResult` with `outcome: ERROR` → the submission is marked `failed` and the
BullMQ *job* completes successfully. Only infrastructure failures (Docker daemon down)
throw, so BullMQ's retry/backoff applies where retrying can actually help. Verified:
after a run with one failed submission, `bull:execution:failed` was still 0.

**`CodeExecutor` is an abstract seam.** The worker never knows how code runs. That
allows swapping Docker for gVisor/Firecracker later, and injecting a fake in tests.

## Sandbox security (DockerExecutor)

| Flag | Attack it closes |
|---|---|
| `NetworkMode: none` + `NetworkDisabled` | exfiltration, second-stage payloads, outbound abuse |
| `Memory` + `MemorySwap` (256MB) | OOM-ing the host; swap thrashing |
| `CpuQuota/CpuPeriod` (0.5 core) | busy-loops starving other workers |
| `PidsLimit: 64` | fork bombs |
| `ReadonlyRootfs: true` | tampering with binaries, filling host disk |
| `Tmpfs /tmp` (32MB, noexec/nosuid) | gives compilers scratch space without a writable rootfs |
| `CapDrop: ALL` | every Linux capability escalation |
| `SecurityOpt: no-new-privileges` | setuid escalation mid-execution |
| `User: sandbox` (uid 10001) | root-in-container |
| SIGKILL on timeout | code trapping SIGTERM to outlive its budget |

Output is capped at 64KB per stream — an infinite `print` loop would otherwise stream
gigabytes into memory before the timeout fires. `OOMKilled` is surfaced explicitly,
since otherwise a memory kill just looks like a mysterious exit code 137.

## Running it

```bash
docker compose up -d          # Postgres + Redis
npm install --legacy-peer-deps
cp .env.example .env
npm run migration:run
./docker/build-images.sh      # build cee-python / cee-node / cee-cpp ONCE
npm run start:dev
```

Set `EXECUTOR=local` in `.env` to run without Docker. **It does not sandbox anything**
— it exists only to exercise the queue pipeline on a machine with no Docker daemon,
and the app refuses to boot with it when `NODE_ENV=production`.

## Gotcha: BullMQ + native ESM

BullMQ lazy-loads ioredis with a bare `require('ioredis')`, which doesn't exist in a
`"type": "module"` package. Passing a pre-built client to `BullModule` isn't enough,
because `@nestjs/bullmq` constructs a *separate* Worker per `@Processor` that builds
its own connection. The fix is the global escape hatch — `RedisConnection.clientFactory`
(see `src/queue/redis-driver.ts`), registered in `main.ts` before Nest initialises.

## Verified end-to-end

- `pending → running → completed` with stdout captured
- runtime error → `failed`, traceback stored in `error_message`
- `while True: pass` → `timeout` after 5s, process force-killed
- stdin piped through (`21` → `42`)
- Python and JavaScript both execute
- 8 concurrent submissions processed with `concurrency: 4`
- **crash recovery**: SIGKILL'd the worker mid-job; BullMQ emitted
  `stalled → waiting → active → completed` and the job re-ran to completion
- 30 unit tests passing

## Bugfix: "container rootfs is marked read-only"

Found when testing `EXECUTOR=docker` for real (this sandbox has no Docker
daemon, so `DockerExecutor` itself was verified by code + shell-logic
inspection, not a live run — this was the first real Docker test).

**Symptom:** every submission failed immediately with `errorMessage: "Error:
(HTTP code 400) client error, bad parameters - container rootfs is marked
read-only"`.

**Root cause:** the original code wrote the source file into `/sandbox` via
`container.putArchive()` *before* calling `container.start()`. But `/sandbox`
lived on a tmpfs mount, and tmpfs mounts are only established once the
container's mount namespace exists — which happens at `start()`, not at
`createContainer()`. Writing before start either hit the read-only rootfs
directly (what actually happened here) or, on some storage drivers, would
have silently gotten shadowed the moment the tmpfs mounted over it.

**Fix:** the source now travels as a base64-encoded `CEE_SRC` environment
variable, decoded by the container's own command as its first step (`echo
"$CEE_SRC" | base64 -d > /sandbox/main.py && python3 /sandbox/main.py`). The
write happens *from inside the running container*, after the tmpfs is
already mounted — no timing race. Base64 also means arbitrary user code
(quotes, backticks, `$(...)`) is never interpreted as shell syntax, since
it's decoded as data, not executed as text.

A second latent bug was caught by the same fix: the original `/tmp` tmpfs was
mounted `noexec`, which would have silently broken C++ (compile succeeds,
then the compiled binary can't execute). The single `/sandbox` tmpfs is now
`exec`-allowed, since C++ both compiles *and* runs from there.
