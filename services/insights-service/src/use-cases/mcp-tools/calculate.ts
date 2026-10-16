import { DomainError } from '../../entities/errors/domain-errors';

export const CALCULATE_OPERATIONS = ['SUM', 'DIFF', 'AVG', 'PERCENT', 'RATIO', 'MIN', 'MAX', 'PERCENT_CHANGE'] as const;
export type CalculateOperation = (typeof CALCULATE_OPERATIONS)[number];

export interface CalculateOut {
  operation: CalculateOperation;
  values: number[];
  result: number;
  formula: string;
}

/** Typed, recoverable errors of the `calculate` tool (the model can correct the call). */
export class DivisionByZeroError extends DomainError {
  constructor(operation: CalculateOperation) {
    super('DIVISION_BY_ZERO', `${operation}: the divisor is 0, the result is undefined`);
  }
}
export class InvalidOperandsError extends DomainError {
  constructor(message: string) {
    super('INVALID_OPERANDS', message);
  }
}

/** Half away from zero to 2 decimals; never `-0`. */
export const round2 = (n: number): number => {
  const r = (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
  return r === 0 ? 0 : r;
};
const fmt = (n: number): string => String(Number(n.toFixed(6)));

/**
 * Pure arithmetic behind the `calculate` MCP tool: deterministic, no I/O. It lets derived figures (averages, percentages,
 * differences) come from a tool so the answer verifier can trace them (`agentes-y-reportes-generativos.md`).
 */
export class CalculateUseCase {
  execute(operation: CalculateOperation, values: number[]): CalculateOut {
    if (!CALCULATE_OPERATIONS.includes(operation)) throw new InvalidOperandsError(`unknown operation ${String(operation)}`);
    if (values.length < 1 || values.length > 100 || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new InvalidOperandsError('values must be 1 to 100 finite numbers');
    }
    const need = (n: number, exactly: boolean) => {
      if (exactly ? values.length !== n : values.length < n) throw new InvalidOperandsError(`${operation} needs ${exactly ? 'exactly' : 'at least'} ${n} values`);
    };
    const [a = 0, b = 0] = values;
    const list = (sep: string) => values.map(fmt).join(sep);
    let raw: number;
    let formula: string;
    switch (operation) {
      case 'SUM':
        raw = values.reduce((s, v) => s + v, 0);
        formula = values.length === 1 ? fmt(a) : list(' + ');
        break;
      case 'DIFF':
        need(2, false);
        raw = values.slice(1).reduce((s, v) => s - v, a);
        formula = list(' - ');
        break;
      case 'AVG':
        raw = values.reduce((s, v) => s + v, 0) / values.length;
        formula = `(${list(' + ')}) / ${values.length}`;
        break;
      case 'MIN':
        raw = Math.min(...values);
        formula = `min(${list(', ')})`;
        break;
      case 'MAX':
        raw = Math.max(...values);
        formula = `max(${list(', ')})`;
        break;
      case 'RATIO':
        need(2, true);
        if (b === 0) throw new DivisionByZeroError(operation);
        raw = a / b;
        formula = `${fmt(a)} / ${fmt(b)}`;
        break;
      case 'PERCENT':
        need(2, true);
        if (b === 0) throw new DivisionByZeroError(operation);
        raw = (a / b) * 100;
        formula = `${fmt(a)} / ${fmt(b)} * 100`;
        break;
      case 'PERCENT_CHANGE':
        need(2, true);
        if (a === 0) throw new DivisionByZeroError(operation);
        raw = ((b - a) / a) * 100;
        formula = `(${fmt(b)} - ${fmt(a)}) / ${fmt(a)} * 100`;
        break;
    }
    const result = round2(raw);
    return { operation, values, result, formula: `${formula} = ${fmt(result)}` };
  }
}
