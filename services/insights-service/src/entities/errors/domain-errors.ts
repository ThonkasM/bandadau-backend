/** Domain errors carry a stable `code` (Problem Details `code`, MCP tool error `code`). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ReportNotFoundError extends DomainError {
  constructor() {
    super('REPORT_NOT_FOUND', 'Report not found');
  }
}
export class AlertNotFoundError extends DomainError {
  constructor() {
    super('ALERT_NOT_FOUND', 'Alert not found');
  }
}
export class AgentRunNotFoundError extends DomainError {
  constructor() {
    super('AGENT_RUN_NOT_FOUND', 'Agent run not found');
  }
}
export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly errors: { field: string; code: string; message: string }[] = [],
  ) {
    super('VALIDATION_ERROR', message);
  }
}
export class InvalidCursorError extends DomainError {
  constructor() {
    super('INVALID_CURSOR', 'Invalid pagination cursor');
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
  }
}
export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSec: number) {
    super('RATE_LIMITED', 'Rate limit exceeded', { retryAfterSec });
  }
}
export class UpstreamUnavailableError extends DomainError {
  constructor(service: string, message?: string) {
    super('UPSTREAM_UNAVAILABLE', message ?? `${service} is unavailable`, { service });
  }
}
export class LlmUnavailableError extends DomainError {
  constructor(message = 'The language model is unavailable') {
    super('LLM_UNAVAILABLE', message);
  }
}
export class LlmRefusalError extends DomainError {
  constructor() {
    super('LLM_REFUSAL', 'The language model refused to answer');
  }
}
export class AgentStepLimitError extends DomainError {
  constructor(readonly stopReason: 'MAX_STEPS' | 'MAX_TOKENS' | 'MAX_TOOL_CALLS' | 'TIMEOUT' = 'MAX_STEPS') {
    super('AGENT_STEP_LIMIT', `Agent limit reached: ${stopReason}`);
  }
}
export class AlertConflictError extends DomainError {
  constructor() {
    super('ALERT_ALREADY_RESOLVED', 'The alert is already resolved');
  }
}
