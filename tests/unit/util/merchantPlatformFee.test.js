import { describe, expect, it } from '@jest/globals';
import {
    getMerchantConfiguredStripePlatformFeeCents,
    getDefaultStripePlatformFeeCents,
    resolveConfiguredStripePlatformFeeCents,
    normalizePerTransactionPlatformFeeCents,
    resolveOrderQuantityFromTicket,
    resolveStripePlatformFeeCents,
    PLATFORM_FEE_BASIS,
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

    it('normalizes qty-scaled fee back to per-transaction merchant config', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        expect(resolveStripePlatformFeeCents({
            paymentIntent: { application_fee_amount: 450 },
            merchant,
            orderQuantity: 3,
        })).toBe(150);
    });

    it('keeps flat fee when order quantity is greater than one', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        expect(resolveStripePlatformFeeCents({
            paymentIntent: { application_fee_amount: 150 },
            merchant,
            orderQuantity: 3,
        })).toBe(150);
    });

    it('reads order quantity from ticketInfo.orderQuantity', () => {
        const ticket = {
            ticketInfo: {
                orderQuantity: '4',
                quantity: '12',
            },
        };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(4);
    });

    it('derives order quantity from admission quantity and pack size', () => {
        const ticket = {
            ticketInfo: {
                quantity: '6',
                packSize: '3',
            },
        };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(2);
    });

    it('falls back to env default when merchant has no stripe fee', () => {
        const prev = process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
        process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = '150';
        try {
            expect(resolveConfiguredStripePlatformFeeCents({ otherInfo: {} })).toBe(150);
            expect(getDefaultStripePlatformFeeCents()).toBe(150);
        } finally {
            if (prev === undefined) delete process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
            else process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = prev;
        }
    });

    it('prefers merchant config over env default', () => {
        const prev = process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
        process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = '15';
        try {
            expect(resolveConfiguredStripePlatformFeeCents({ otherInfo: { stripe: 150 } })).toBe(150);
        } finally {
            if (prev === undefined) delete process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
            else process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = prev;
        }
    });

    it('exposes per-transaction fee basis constant', () => {
        expect(PLATFORM_FEE_BASIS).toBe('per_transaction');
    });

    it('normalizePerTransactionPlatformFeeCents leaves non-scaled fees unchanged', () => {
        expect(normalizePerTransactionPlatformFeeCents(500, {
            orderQuantity: 3,
            configuredFeeCents: 150,
        })).toBe(500);
    });
});
