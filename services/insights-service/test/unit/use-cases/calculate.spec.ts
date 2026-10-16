import { CalculateUseCase, DivisionByZeroError, InvalidOperandsError, round2 } from '../../../src/use-cases/mcp-tools/calculate';

describe('CalculateUseCase (tool `calculate`)', () => {
  const calc = new CalculateUseCase();
  const run = (op: Parameters<CalculateUseCase['execute']>[0], values: number[]) => calc.execute(op, values);

  it.each([
    ['SUM', [1, 2.5, 3], 6.5, '1 + 2.5 + 3 = 6.5'],
    ['DIFF', [100, 30, 5], 65, '100 - 30 - 5 = 65'],
    ['AVG', [10, 20, 25], 18.33, '(10 + 20 + 25) / 3 = 18.33'],
    ['PERCENT', [45, 180], 25, '45 / 180 * 100 = 25'],
    ['RATIO', [815, 12], 67.92, '815 / 12 = 67.92'],
    ['MIN', [4, -2, 9], -2, 'min(4, -2, 9) = -2'],
    ['MAX', [4, -2, 9], 9, 'max(4, -2, 9) = 9'],
    ['PERCENT_CHANGE', [200, 250], 25, '(250 - 200) / 200 * 100 = 25'],
    ['PERCENT_CHANGE', [250, 200], -20, '(200 - 250) / 250 * 100 = -20'],
  ] as const)('%s %j', (op, values, result, formula) => {
    expect(run(op, [...values])).toEqual({ operation: op, values, result, formula });
  });

  it('rounds half away from zero to 2 decimals and never returns -0', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2 / 3)).toBe(0.67);
    expect(Object.is(round2(-0.0001), 0)).toBe(true);
  });

  it('is deterministic (same input, same output) and does not mutate its input', () => {
    const v = [3, 4, 5];
    expect(run('AVG', v)).toEqual(run('AVG', v));
    expect(v).toEqual([3, 4, 5]);
  });

  it('rejects division by zero with a typed error', () => {
    expect(() => run('RATIO', [1, 0])).toThrow(DivisionByZeroError);
    expect(() => run('PERCENT', [1, 0])).toThrow(DivisionByZeroError);
    expect(() => run('PERCENT_CHANGE', [0, 5])).toThrow(DivisionByZeroError);
    try {
      run('RATIO', [1, 0]);
    } catch (e) {
      expect((e as DivisionByZeroError).code).toBe('DIVISION_BY_ZERO');
    }
  });

  it('rejects the wrong number of operands and non-finite values', () => {
    expect(() => run('DIFF', [1])).toThrow(InvalidOperandsError);
    expect(() => run('RATIO', [1, 2, 3])).toThrow(InvalidOperandsError);
    expect(() => run('SUM', [])).toThrow(InvalidOperandsError);
    expect(() => run('SUM', [1, Number.NaN])).toThrow(InvalidOperandsError);
    expect(() => run('SUM', Array(101).fill(1))).toThrow(InvalidOperandsError);
  });
});
