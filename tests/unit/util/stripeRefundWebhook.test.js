import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockApplyRefund = jest.fn();

jest.unstable_mockModule('../../../src/services/refundService.js', () => ({
    applyRefund: mockApplyRefund
}));

const { handleStripeRefundWebhookEvent, handleChargeRefundedWebhookEvent } = await import('../../../util/stripeRefundWebhook.js');

describe('stripeRefundWebhook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('processes refund.updated with succeeded status', async () => {
        mockApplyRefund.mockResolvedValue({ success: true });

        const event = {
            type: 'refund.updated',
            id: 'evt_1',
            data: {
                object: {
                    id: 're_123',
                    payment_intent: 'pi_123',
                    amount: 2500,
                    currency: 'eur',
                    status: 'succeeded',
                    charge: 'ch_123'
                }
            }
        };

        const result = await handleStripeRefundWebhookEvent(event);

        expect(mockApplyRefund).toHaveBeenCalledWith(expect.objectContaining({
            stripeRefundId: 're_123',
            paymentIntentId: 'pi_123',
            amount: 2500,
            status: 'succeeded',
            source: 'dashboard'
        }));
        expect(result.success).toBe(true);
    });

    it('ignores refund.updated when status is pending', async () => {
        const result = await handleStripeRefundWebhookEvent({
            type: 'refund.updated',
            data: {
                object: {
                    id: 're_pending',
                    payment_intent: 'pi_123',
                    amount: 2500,
                    status: 'pending'
                }
            }
        });

        expect(mockApplyRefund).not.toHaveBeenCalled();
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('refund_not_succeeded');
    });

    it('logs charge.refunded without calling applyRefund', async () => {
        const result = await handleChargeRefundedWebhookEvent({
            type: 'charge.refunded',
            id: 'evt_charge',
            account: 'acct_123',
            data: {
                object: {
                    id: 'ch_123',
                    payment_intent: 'pi_123',
                    amount_refunded: 2500,
                    refunded: true
                }
            }
        });

        expect(mockApplyRefund).not.toHaveBeenCalled();
        expect(result.logged).toBe(true);
        expect(result.paymentIntentId).toBe('pi_123');
    });

    it('ignores refund.created events', async () => {
        const result = await handleStripeRefundWebhookEvent({
            type: 'refund.created',
            data: {
                object: {
                    id: 're_123',
                    payment_intent: 'pi_123',
                    status: 'succeeded'
                }
            }
        });

        expect(mockApplyRefund).not.toHaveBeenCalled();
        expect(result.skipped).toBe(true);
    });
});
