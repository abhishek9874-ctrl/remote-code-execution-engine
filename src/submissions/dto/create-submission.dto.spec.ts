import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, it, expect } from 'vitest';
import { CreateSubmissionDto } from './create-submission.dto.js';
import { SubmissionLanguage } from '../entities/submission.entity.js';

// These exercise the actual class-validator decorators directly — no HTTP
// layer needed — so they run fast and pin down exactly which rule fired.
async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateSubmissionDto, payload);
  return validate(dto);
}

describe('CreateSubmissionDto validation', () => {
  it('passes for a valid submission', async () => {
    const errors = await validateDto({
      code: 'print(1)',
      language: SubmissionLanguage.PYTHON,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty code', async () => {
    const errors = await validateDto({ code: '', language: 'python' });
    expect(errors.some((e) => e.property === 'code')).toBe(true);
  });

  it('rejects whitespace-only code (Day 3 edge case)', async () => {
    const errors = await validateDto({ code: '   \n\t  ', language: 'python' });
    const codeError = errors.find((e) => e.property === 'code');
    expect(codeError).toBeDefined();
    expect(codeError?.constraints).toHaveProperty('matches');
  });

  it('rejects code over the max length', async () => {
    const errors = await validateDto({
      code: 'a'.repeat(20_001),
      language: 'python',
    });
    const codeError = errors.find((e) => e.property === 'code');
    expect(codeError?.constraints).toHaveProperty('maxLength');
  });

  it('accepts code at exactly the max length boundary', async () => {
    const errors = await validateDto({
      code: 'a'.repeat(20_000),
      language: 'python',
    });

    


    expect(errors.some((e) => e.property === 'code')).toBe(false);
  });




  it('rejects a language outside the whitelist', async () => {
    const errors = await validateDto({ code: 'puts 1', language: 'ruby' });
    const langError = errors.find((e) => e.property === 'language');
    expect(langError?.constraints).toHaveProperty('isEnum');
  });

  it('rejects a missing language field', async () => {
    const errors = await validateDto({ code: 'print(1)' });
    expect(errors.some((e) => e.property === 'language')).toBe(true);
  });

  it('accepts a submission without optional stdin/expectedOutput', async () => {
    const errors = await validateDto({ code: 'print(1)', language: 'python' });
    expect(errors).toHaveLength(0);
  });

  it('rejects stdin over its max length', async () => {
    const errors = await validateDto({
      code: 'print(1)',
      language: 'python',
      stdin: 'x'.repeat(5_001),
    });
    expect(errors.some((e) => e.property === 'stdin')).toBe(true);
  });
});
