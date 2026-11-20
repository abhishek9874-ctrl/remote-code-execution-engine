import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubmissionsService } from './submissions.service.js';
import { EXECUTION_QUEUE } from '../queue/queue.constants.js';
import {
  Submission,
  SubmissionLanguage,
  SubmissionStatus,
} from './entities/submission.entity.js';

// A fake in-memory repository so these tests don't need a real Postgres
// connection. This is the standard way to unit test a NestJS service.
function createMockRepo() {
  return {
    create: vi.fn((dto) => dto),
    save: vi.fn(async (entity) => ({
      id: 'test-uuid-1234',
      status: SubmissionStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      result: null,
      errorMessage: null,
      ...entity,
    })),
    findOne: vi.fn(),
    findAndCount: vi.fn(),
  };
}

describe('SubmissionsService', () => {
  let service: SubmissionsService;
  let repo: ReturnType<typeof createMockRepo>;
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = createMockRepo();
    queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: getRepositoryToken(Submission), useValue: repo },
        { provide: getQueueToken(EXECUTION_QUEUE), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(SubmissionsService);
  });

  describe('create', () => {
    it('saves a new submission with status PENDING', async () => {
      const result = await service.create({
        code: 'print("hello")',
        language: SubmissionLanguage.PYTHON,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print("hello")',
          language: SubmissionLanguage.PYTHON,
          status: SubmissionStatus.PENDING,
        }),
      );
      expect(result.status).toBe(SubmissionStatus.PENDING);
      expect(result.id).toBe('test-uuid-1234');
    });

    it('defaults stdin and expectedOutput to null when not provided', async () => {
      await service.create({
        code: 'print(1)',
        language: SubmissionLanguage.PYTHON,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ stdin: null, expectedOutput: null }),
      );
    });

    it('enqueues a job carrying only the submission id', async () => {
      const saved = await service.create({
        code: 'print(1)',
        language: SubmissionLanguage.PYTHON,
      });

      expect(queue.add).toHaveBeenCalledWith(
        'execute',
        expect.objectContaining({
          submissionId: saved.id,
          traceContext: expect.any(Object),
        }),
        expect.objectContaining({
          attempts: 3,
        }),
      );




    });

    it('saves to the database BEFORE enqueuing', async () => {
      const order: string[] = [];
      repo.save.mockImplementation(async (e) => {
        order.push('save');
        return { id: 'test-uuid-1234', ...e };
      });
      queue.add.mockImplementation(async () => {
        order.push('enqueue');
        return { id: 'job-1' };
      });

      await service.create({
        code: 'print(1)',
        language: SubmissionLanguage.PYTHON,
      });

      // Reversed, a fast worker could look up a row that hasn't committed.
      expect(order).toEqual(['save', 'enqueue']);
    });

    it('still returns the submission when the queue is unreachable', async () => {
      queue.add.mockRejectedValue(new Error('ECONNREFUSED'));

      const saved = await service.create({
        code: 'print(1)',
        language: SubmissionLanguage.PYTHON,
      });

      // The row is committed, so the user gets a real 201 and an id they
      // can poll. It stays 'pending' until something re-enqueues it.
      expect(saved.id).toBe('test-uuid-1234');
    });
  });

  describe('findOne', () => {
    it('returns the submission when found', async () => {
      repo.findOne.mockResolvedValue({ id: 'abc', status: 'pending' });

      const result = await service.findOne('abc');

      expect(result).toEqual({ id: 'abc', status: 'pending' });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'abc' } });
    });

    it('throws NotFoundException when the submission does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns paginated results with defaults', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: '1' }, { id: '2' }], 2]);

      const result = await service.findAll({});

      expect(result).toEqual({ data: [{ id: '1' }, { id: '2' }], total: 2, page: 1, limit: 20 });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('applies custom page and limit to skip/take', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 3, limit: 10 });

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
