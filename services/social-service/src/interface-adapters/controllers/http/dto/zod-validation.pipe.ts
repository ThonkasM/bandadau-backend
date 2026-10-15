import { HttpException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

interface FieldIssue {
  field: string;
  pointer: string;
  code: string;
  params?: Record<string, unknown>;
}

function toFieldIssues(error: z.ZodError, prefix: string | undefined): FieldIssue[] {
  return error.issues.map((issue) => {
    const path = [...(prefix ? [prefix] : []), ...issue.path.map(String)];
    const field = path.join('.') || prefix || 'body';
    const pointer = `/${path.join('/')}`;
    const raw = issue as unknown as { maximum?: number; minimum?: number; message: string; origin?: string };
    let code = 'INVALID_VALUE';
    let params: Record<string, unknown> | undefined;
    if (issue.code === 'invalid_type' && /received undefined/.test(issue.message)) code = 'REQUIRED';
    else if (issue.code === 'too_big' && raw.origin !== 'number') {
      code = 'TOO_LONG';
      params = { max: raw.maximum };
    } else if (issue.code === 'too_small' && raw.origin === 'string') {
      code = raw.minimum === 1 ? 'REQUIRED' : 'TOO_SHORT';
      params = { min: raw.minimum };
    } else if (issue.code === 'invalid_format') code = 'INVALID_FORMAT';
    return { field, pointer, code, ...(params ? { params } : {}) };
  });
}

/** Validates (and coerces) a body/query/param with zod; failures become `400 VALIDATION_FAILED` with per-field errors. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly field?: string,
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new HttpException({ code: 'VALIDATION_FAILED', errors: toFieldIssues(result.error, this.field) }, 400);
  }
}
