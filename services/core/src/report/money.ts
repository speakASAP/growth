/**
 * Decimal money arithmetic (C-006 §6.2).
 *
 * Every amount in this service is a decimal STRING and is stored as `NUMERIC(20,4)`. Nothing here
 * touches `Number`, `parseFloat` or JSON's number type: a double cannot represent 0.1, and the
 * error compounds over a sum. Amounts are parsed into `BigInt` scaled by 10^4 — the same scale the
 * column uses, so the round trip is lossless by construction rather than by luck.
 *
 * The cost metrics are divisions, which do not stay exact at any scale, so they are the one place
 * rounding happens: half-up to 2dp, once, at the end.
 */

const SCALE = 4;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** The same pattern the contract schema enforces on `amount.value`. */
const DECIMAL = /^-?\d+(\.\d{1,4})?$/;

/** Parse a decimal string into an integer scaled by 10^4. */
function toScaled(value: string): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    // Loud rather than coerced. A silently-coerced amount is a wrong number that looks right.
    throw new Error(`not a decimal money string: ${JSON.stringify(value)}`);
  }

  const negative = value.startsWith('-');
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPart.padEnd(SCALE, '0'));

  return negative ? -scaled : scaled;
}

/** Render a scaled integer back as a decimal string with exactly 4 decimal places. */
function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0');

  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Exact sum of decimal money strings.
 *
 * Returns `null` for an empty list rather than `"0.0000"`: "no spend has been recorded" and "the
 * spend recorded is zero" are different facts, and only one of them means the report is incomplete.
 */
export function sumDecimalStrings(values: readonly string[]): string | null {
  if (values.length === 0) return null;

  return fromScaled(values.reduce<bigint>((total, value) => total + toScaled(value), 0n));
}

/**
 * `total / divisor`, rounded half away from zero to 2dp, as a decimal string.
 *
 * `null` when there is nothing to divide or nothing to divide by (C-006 §6.3) — the caller renders
 * that as "—". Returning `0` would read as "this experiment is free" at precisely the moment it has
 * produced no qualified leads at all.
 */
export function divideToScale2(total: string | null, divisor: number): string | null {
  if (total === null) return null;
  if (!Number.isInteger(divisor) || divisor === 0) return null;

  const scaled = toScaled(total);

  // Dividing a scale-4 numerator by (100 * divisor) lands the quotient at scale 2 directly, so
  // there is exactly one rounding step instead of one per intermediate.
  const denominator = 100n * BigInt(divisor);
  const negative = scaled < 0n !== denominator < 0n;
  const absNumerator = scaled < 0n ? -scaled : scaled;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  // Half away from zero: add half the denominator before truncating. Banker's rounding is correct
  // for repeated accounting sums and wrong here — this is a reported metric, and the owner
  // comparing it against a hand calculation should get the same answer.
  const quotient = (2n * absNumerator + absDenominator) / (2n * absDenominator);
  const signed = negative ? -quotient : quotient;

  const abs = signed < 0n ? -signed : signed;
  return `${signed < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
