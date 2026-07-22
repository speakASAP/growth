import { divideToScale2, sumDecimalStrings } from './money';

/**
 * C-006 §6.2 — money is decimal end to end.
 *
 * These tests exist to fail if anyone routes the sum through `Number`. The values are chosen so a
 * float implementation produces a visibly wrong answer rather than a plausible one.
 */
describe('sumDecimalStrings', () => {
  it('sums exact decimals without float drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as IEEE-754. As decimal it is exactly 0.3.
    expect(sumDecimalStrings(['0.1000', '0.2000'])).toBe('0.3000');
  });

  it('keeps cents that a float would lose at NUMERIC(20,4) magnitudes', () => {
    // This is the test that actually catches a float implementation, and it was rewritten after a
    // falsification run: the original used 99999999999.9999 + 0.0001, and a `Number` sum followed
    // by .toFixed(4) PASSED it, because the drift fell outside the 4 decimal places being compared.
    // A guard that cannot fail when the thing it guards is broken is not a guard.
    //
    // 1234567890123456.0001 needs 20 significant digits, which the column allows and a double
    // cannot hold — a float sum silently truncates the .0001 and returns ...456.0000.
    expect(sumDecimalStrings(['1234567890123456.0001', '0.0001'])).toBe('1234567890123456.0002');
  });

  it('sums the ordinary case', () => {
    expect(sumDecimalStrings(['1500.0000', '2000.5000'])).toBe('3500.5000');
  });

  it('accepts a negative observation — a provider credit is meaningful (C-006 §2.2)', () => {
    expect(sumDecimalStrings(['1500.0000', '-500.0000'])).toBe('1000.0000');
  });

  it('is null for no observations, not zero', () => {
    // Zero spend and no spend recorded are different facts and must not render alike.
    expect(sumDecimalStrings([])).toBeNull();
  });

  it('rejects a value that is not a decimal string', () => {
    expect(() => sumDecimalStrings(['1500.0000', '12e3'])).toThrow(/decimal/i);
  });

  it('rejects a number masquerading as an amount', () => {
    expect(() => sumDecimalStrings([1500 as unknown as string])).toThrow(/decimal/i);
  });
});

describe('divideToScale2', () => {
  it('divides exactly when it divides exactly', () => {
    expect(divideToScale2('15000.0000', 24)).toBe('625.00');
  });

  it('rounds half-up to 2dp', () => {
    // 15000 / 7 = 2142.857142... -> 2142.86
    expect(divideToScale2('15000.0000', 7)).toBe('2142.86');
  });

  it('rounds a true half away from zero', () => {
    // 1.005 -> 1.01, the case banker's rounding would get "wrong" for money reporting
    expect(divideToScale2('2.0100', 2)).toBe('1.01');
  });

  it('returns null on division by zero rather than Infinity (C-006 §6.3)', () => {
    // Zero qualified leads must render "—". Infinity or NaN would reach the screen as text.
    expect(divideToScale2('15000.0000', 0)).toBeNull();
  });

  it('returns null when there is no spend to divide', () => {
    expect(divideToScale2(null, 24)).toBeNull();
  });

  it('handles a negative total', () => {
    expect(divideToScale2('-15000.0000', 24)).toBe('-625.00');
  });
});
