import { describe, expect, it } from '@jest/globals';
import {
    getMerchantConfiguredStripePlatformFeeCents,
    resolveStripePlatformFeeCents,
} from '../../../util/merchantPlatformFee.js';

describe('merchantPlatformFee', () => {
    it('reads configured stripe fee from otherInfo map', () => {
        const merchant = { otherInfo: new Map([['stripe', 700]]) };
        expect(getMerchantConfiguredStripePlatformFeeCents(merchant)).toBe(700);
    });

    it('reads configured stripe fee from plain otherInfo object', () => {
        const merchant = { otherInfo: { stripe: 700 } };
        expect(getMerchantConfiguredStripePlatformFeeCents(merchant)).toBe(700);
    });

    it('prefers application_fee_amount over merchant config', () => {
        const merchant = { otherInfo: { stripe: 700 } };
        expect(resolveStripePlatformFeeCents({
            paymentIntent: { application_fee_amount: 500 },
            merchant,
        })).toBe(500);
    });

    it('falls back to merchant config when PI has no application fee', () => {
        const merchant = { otherInfo: { stripe: 700 } };
        expect(resolveStripePlatformFeeCents({
            paymentIntent: { application_fee_amount: null },
            stripeMetadata: {},
            merchant,
        })).toBe(700);
    });

    it('uses metadata platformFee before merchant config', () => {
        const merchant = { otherInfo: { stripe: 700 } };
        expect(resolveStripePlatformFeeCents({
            paymentIntent: {},
            stripeMetadata: { platformFee: '250' },
            merchant,
        })).toBe(250);
    });
});
