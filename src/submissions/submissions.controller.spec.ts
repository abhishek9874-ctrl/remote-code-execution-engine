import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';
import { SubmissionLanguage } from './entities/submission.entity.js';

describe('SubmissionsController', () => {
  let controller: SubmissionsController;
  let service: { create: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>; findAll: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { create: vi.fn(), findOne: vi.fn(), findAll: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [{ provide: SubmissionsService, useValue: service }],
    }).compile();

    controller = moduleRef.get(SubmissionsController);
  });

  it('create() delegates to service.create with the DTO', async () => {
    const dto = { code: 'print(1)', language: SubmissionLanguage.PYTHON };
    service.create.mockResolvedValue({ id: '1', ...dto });

    const result = await controller.create(dto);

    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: '1', ...dto });
  });

  it('findOne() delegates to service.findOne with the id', async () => {
    service.findOne.mockResolvedValue({ id: 'abc' });

    const result = await controller.findOne('abc');

    expect(service.findOne).toHaveBeenCalledWith('abc');
    expect(result).toEqual({ id: 'abc' });
  });

  it('findAll() delegates to service.findAll with query params', async () => {
    service.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    const result = await controller.findAll({ page: 1, limit: 20 });

    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(result.total).toBe(0);
  });
});
