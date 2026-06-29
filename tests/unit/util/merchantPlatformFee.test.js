import { describe, expect, it } from '@jest/globals';
import {
    getMerchantConfiguredStripePlatformFeeCents,
    getDefaultStripePlatformFeeCents,
    resolveConfiguredStripePlatformFeeCents,
    scalePlatformFeeByOrderQuantity,
    resolveOrderQuantityFromTicket,
    resolveAdmissionQuantityFromTicket,
    resolveOrderQuantityFromMetadata,
    readRecordedPlatformFeeCents,
    resolvePublishedPlatformFeeCents,
    resolvePublishedUnitPlatformFeeCents,
    readTicketInfoStoredInt,
    copyRecordedPlatformFeeToTicketInfo,
    PLATFORM_FEE_BASIS,
} from '../../../util/merchantPlatformFee.js';

describe('merchantPlatformFee', () => {
    it('reads configured stripe fee from otherInfo map', () => {
        const merchant = { otherInfo: new Map([['stripe', 700]]) };
        expect(getMerchantConfiguredStripePlatformFeeCents(merchant)).toBe(700);
    });

    it('reads order quantity from ticketInfo.orderQuantity only', () => {
        const ticket = {
            ticketInfo: {
                orderQuantity: '2',
                quantity: '6',
            },
        };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(2);
        expect(resolveAdmissionQuantityFromTicket(ticket)).toBe(6);
    });

    it('derives legacy orderQuantity from quantity when packSize is 1', () => {
        const ticket = { ticketInfo: { quantity: '2' } };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(2);
        expect(resolveAdmissionQuantityFromTicket(ticket)).toBe(2);
    });

    it('derives orderQuantity from quantity and packSize for pack tickets', () => {
        const ticket = { ticketInfo: { quantity: '3', packSize: '3' } };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(1);
        expect(resolveAdmissionQuantityFromTicket(ticket)).toBe(3);
    });

    it('prefers stored orderQuantity over quantity', () => {
        const ticket = { ticketInfo: { orderQuantity: '1', quantity: '3', packSize: '3' } };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(1);
    });

    it('uses packSizeHint for legacy pack tickets without stored packSize', () => {
        const ticket = { ticketInfo: { quantity: '3' } };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(3);
        expect(resolveOrderQuantityFromTicket(ticket, { packSizeHint: 3 })).toBe(1);
    });

    it('stored packSize wins over packSizeHint', () => {
        const ticket = { ticketInfo: { quantity: '6', packSize: '3' } };
        expect(resolveOrderQuantityFromTicket(ticket, { packSizeHint: 2 })).toBe(2);
    });

    it('returns null when quantity is not a whole multiple of packSizeHint', () => {
        const ticket = { ticketInfo: { quantity: '5' } };
        expect(resolveOrderQuantityFromTicket(ticket, { packSizeHint: 3 })).toBeNull();
    });

    it('legacy pack ticket fee uses packSizeHint (group of 3 = 1 order)', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        const ticket = { ticketInfo: { quantity: '3', platformFee: 150 } };
        expect(resolvePublishedPlatformFeeCents(ticket, merchant, { grossCents: 23700, method: 'stripe', packSizeHint: 3 })).toBe(150);
    });

    it('Hobart backfill case: qty 2 legacy ticket × 150¢ unit = 300¢', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        const ticket = {
            ticketInfo: {
                quantity: '2',
                platformFee: 150,
            },
        };
        expect(resolveOrderQuantityFromTicket(ticket)).toBe(2);
        expect(resolvePublishedPlatformFeeCents(ticket, merchant, { grossCents: 15800, method: 'stripe' })).toBe(300);
    });

    it('resolvePublishedPlatformFeeCents scales flat platformFee when unit cannot be resolved', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        const ticket = {
            ticketInfo: {
                platformFee: 150,
                platformFeeBasis: 'per_order_quantity',
                orderQuantity: '4',
                quantity: '4',
            },
        };
        expect(resolvePublishedPlatformFeeCents(ticket, merchant, { grossCents: 41400, method: 'stripe' })).toBe(600);
    });

    it('resolvePublishedPlatformFeeCents keeps already-scaled platformFee total', () => {
        const prev = process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
        process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = '150';
        try {
            const ticket = {
                ticketInfo: {
                    platformFee: 600,
                    platformFeeBasis: 'per_order_quantity',
                    orderQuantity: '4',
                    quantity: '4',
                },
            };
            expect(resolvePublishedPlatformFeeCents(ticket, null, { grossCents: 41400, method: 'stripe' })).toBe(600);
        } finally {
            if (prev === undefined) delete process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
            else process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = prev;
        }
    });

    it('resolvePublishedPlatformFeeCents scales unit × orderQuantity even when ticket has flat platformFee', () => {
        const ticket = { ticketInfo: { platformFee: 300, orderQuantity: '2', quantity: '2' } };
        expect(readRecordedPlatformFeeCents(ticket)).toBe(300);
    });

    it('reads platformCommission object from ticket', () => {
        const ticket = {
            ticketInfo: {
                platformCommission: { platformAmount: 250 },
            },
        };
        expect(readRecordedPlatformFeeCents(ticket)).toBe(250);
    });

    it('reads platformFee from ticket only', () => {
        const merchant = { otherInfo: { stripe: 150 } };
        const ticket = {
            ticketInfo: {
                platformFee: 150,
                platformFeeBasis: 'per_order_quantity',
                orderQuantity: '4',
                quantity: '4',
            },
        };
        expect(resolvePublishedPlatformFeeCents(ticket, merchant, { grossCents: 41400, method: 'stripe' })).toBe(600);
    });

    it('resolvePublishedPlatformFeeCents uses env unit fee × orderQuantity when ticket fee is 0', () => {
        const prev = process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
        process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = '150';
        try {
            const ticket = { ticketInfo: { orderQuantity: '2', quantity: '2' } };
            expect(resolvePublishedPlatformFeeCents(ticket, null, { grossCents: 7900, method: 'stripe' })).toBe(300);
            expect(resolvePublishedPlatformFeeCents(ticket, null, { grossCents: 0, method: 'stripe' })).toBe(0);
        } finally {
            if (prev === undefined) delete process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
            else process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = prev;
        }
    });

    it('resolvePublishedPlatformFeeCents prefers merchant unit over env', () => {
        const prev = process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
        process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = '15';
        try {
            const merchant = { otherInfo: { stripe: 150 } };
            const ticket = { ticketInfo: { orderQuantity: '2', quantity: '2' } };
            expect(resolvePublishedPlatformFeeCents(ticket, merchant, { grossCents: 7900, method: 'stripe' })).toBe(300);
        } finally {
            if (prev === undefined) delete process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS;
            else process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS = prev;
        }
    });

    it('copyRecordedPlatformFeeToTicketInfo copies PI application fee', () => {
        const ticketInfo = {};
        copyRecordedPlatformFeeToTicketInfo(ticketInfo, {
            paymentIntent: { application_fee_amount: 300 },
            stripeMetadata: { platformFeeBasis: PLATFORM_FEE_BASIS, platformFeeUnitCents: '150' },
        });
        expect(ticketInfo.platformFee).toBe(300);
        expect(ticketInfo.platformFeeBasis).toBe(PLATFORM_FEE_BASIS);
        expect(ticketInfo.platformFeeUnitCents).toBe('150');
    });

    it('falls back to env default for checkout config only', () => {
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

    it('scalePlatformFeeByOrderQuantity is checkout-only', () => {
        expect(scalePlatformFeeByOrderQuantity(150, 4)).toBe(600);
    });

    it('readTicketInfoStoredInt returns null when field missing', () => {
        expect(readTicketInfoStoredInt({ ticketInfo: {} }, 'orderQuantity')).toBeNull();
    });

    it('resolveOrderQuantityFromMetadata for checkout PI', () => {
        expect(resolveOrderQuantityFromMetadata({ orderQuantity: '3', quantity: '5' })).toBe(3);
    });
});
