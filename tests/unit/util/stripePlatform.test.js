import { describe, it, expect, afterEach } from '@jest/globals';
import { getPlatformStripeAccountId, isPlatformStripeAccount } from '../../../util/stripePlatform.js';

describe('stripePlatform', () => {
  const originalPlatform = process.env.STRIPE_PLATFORM_ACCOUNT_ID;
  const originalAccount = process.env.STRIPE_ACCOUNT_ID;

  afterEach(() => {
    process.env.STRIPE_PLATFORM_ACCOUNT_ID = originalPlatform;
    process.env.STRIPE_ACCOUNT_ID = originalAccount;
  });

  it('prefers STRIPE_PLATFORM_ACCOUNT_ID when set', () => {
    process.env.STRIPE_PLATFORM_ACCOUNT_ID = 'acct_platform';
    process.env.STRIPE_ACCOUNT_ID = 'acct_other';
    expect(getPlatformStripeAccountId()).toBe('acct_platform');
    expect(isPlatformStripeAccount('acct_platform')).toBe(true);
    expect(isPlatformStripeAccount('acct_connected')).toBe(false);
  });

  it('falls back to STRIPE_ACCOUNT_ID when platform var is unset', () => {
    delete process.env.STRIPE_PLATFORM_ACCOUNT_ID;
    process.env.STRIPE_ACCOUNT_ID = 'acct_ems_platform';
    expect(getPlatformStripeAccountId()).toBe('acct_ems_platform');
    expect(isPlatformStripeAccount('acct_ems_platform')).toBe(true);
  });
});
