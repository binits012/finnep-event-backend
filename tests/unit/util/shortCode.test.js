import {
  generateShortCode,
  isValidShortCode,
  SHORT_CODE_LENGTH,
} from '../../../util/shortCode.js';

describe('shortCode util', () => {
  it('generates a 6-character base62 code', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(SHORT_CODE_LENGTH);
    expect(isValidShortCode(code)).toBe(true);
  });

  it('validates short code format', () => {
    expect(isValidShortCode('xK9mP2')).toBe(true);
    expect(isValidShortCode('abc12')).toBe(false);
    expect(isValidShortCode('abc1234')).toBe(false);
    expect(isValidShortCode('abc-12')).toBe(false);
  });
});
