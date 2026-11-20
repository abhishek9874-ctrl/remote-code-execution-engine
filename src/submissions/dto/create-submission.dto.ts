import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SubmissionLanguage } from '../entities/submission.entity.js';

// Code size cap. Prevents someone from POSTing a 50MB "submission" and
// choking your queue/worker. Tune this later once you know real usage.
const MAX_CODE_LENGTH = 20_000;

export class CreateSubmissionDto {
  @IsString()
  // Day 3 fix: @MinLength(1) alone lets " " (a single space) through,
  // since length 1 >= 1. \S requires at least one NON-whitespace
  // character anywhere in the string, which is what we actually want.
  @Matches(/\S/, { message: 'code cannot be empty or only whitespace' })
  @MaxLength(MAX_CODE_LENGTH, {
    message: `code cannot exceed ${MAX_CODE_LENGTH} characters`,
  })
  code: string;

  // class-validator's @IsEnum acts as the language whitelist — anything
  // outside SubmissionLanguage is rejected with a 400 automatically.
  @IsEnum(SubmissionLanguage, {
    message: `language must be one of: ${Object.values(SubmissionLanguage).join(', ')}`,
  })
  language: SubmissionLanguage;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  stdin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  expectedOutput?: string;
}
