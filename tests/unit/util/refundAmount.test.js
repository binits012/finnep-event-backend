import { describe, it, expect } from '@jest/globals';
import {
    resolvePaidAmountCents,
    computeRemainingRefundableCents,
    mapToStripeRefundReason
} from '../../../util/refundAmount.js';

describe('refundAmount utils', () => {
    it('resolvePaidAmountCents from totalPrice', () => {
        const cents = resolvePaidAmountCents({}, { totalPrice: 25.5 });
        expect(cents).toBe(2550);
    });

    it('computeRemainingRefundableCents subtracts prior refunds', () => {
        const remaining = computeRemainingRefundableCents({
            refundAmount: 1000,
            ticketInfo: { totalPrice: 25 }
        });
        expect(remaining).toBe(1500);
    });

    it('mapToStripeRefundReason maps known values', () => {
        expect(mapToStripeRefundReason('fraudulent')).toBe('fraudulent');
        expect(mapToStripeRefundReason('Customer changed mind')).toBe('requested_by_customer');
    });
});
