import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmissionsService } from './submissions.service.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { ListSubmissionsDto } from './dto/list-submissions.dto.js';

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  // POST /submissions
  // Stricter than the global default (30/min) because this endpoint will
  // eventually trigger real Docker container execution in Week 2 — each
  // request is expensive, so it gets its own tighter budget: 10/min/IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateSubmissionDto) {
    return this.submissionsService.create(dto);
  }

  // GET /submissions?page=1&limit=20
  @Get()
  findAll(@Query() query: ListSubmissionsDto) {
    return this.submissionsService.findAll(query);
  }

  // GET /submissions/:id
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.findOne(id);
  }
}
