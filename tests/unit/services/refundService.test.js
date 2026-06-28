import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetRefundByStripeRefundId = jest.fn();
const mockBeginRefundProcessing = jest.fn();
const mockMarkRefundCompleted = jest.fn();
const mockMarkRefundFailed = jest.fn();
const mockAppendRefundReversalErrors = jest.fn();
const mockIsRefundFullyApplied = jest.fn();
const mockGetTicketByPaymentIntentId = jest.fn();
const mockUpdateTicketById = jest.fn();
const mockDeactivateChildTicketsByParentId = jest.fn();
const mockGetTicketById = jest.fn();
const mockIncrementTicketTypeAvailable = jest.fn();
const mockReverseSeatPurchaseAfterRefund = jest.fn();
const mockCreateOutboxMessage = jest.fn();
const mockPublishToExchange = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.unstable_mockModule('../../../model/refund.js', () => ({
    getRefundByStripeRefundId: mockGetRefundByStripeRefundId,
    beginRefundProcessing: mockBeginRefundProcessing,
    markRefundCompleted: mockMarkRefundCompleted,
    markRefundFailed: mockMarkRefundFailed,
    appendRefundReversalErrors: mockAppendRefundReversalErrors,
    isRefundFullyApplied: mockIsRefundFullyApplied
}));

jest.unstable_mockModule('../../../model/ticket.js', () => ({
    getTicketByPaymentIntentId: mockGetTicketByPaymentIntentId,
    updateTicketById: mockUpdateTicketById,
    deactivateChildTicketsByParentId: mockDeactivateChildTicketsByParentId,
    getTicketById: mockGetTicketById
}));

jest.unstable_mockModule('../../../model/event.js', () => ({
    incrementTicketTypeAvailable: mockIncrementTicketTypeAvailable
}));

jest.unstable_mockModule('../../../src/services/seatPurchaseFulfillmentService.js', () => ({
    reverseSeatPurchaseAfterRefund: mockReverseSeatPurchaseAfterRefund
}));

jest.unstable_mockModule('../../../model/outboxMessage.js', () => ({
    createOutboxMessage: mockCreateOutboxMessage
}));

jest.unstable_mockModule('../../../rabbitMQ/services/messageConsumer.js', () => ({
    messageConsumer: { publishToExchange: mockPublishToExchange }
}));

jest.unstable_mockModule('../../../model/redisConnect.js', () => ({
    default: {
        set: mockRedisSet,
        del: mockRedisDel
    }
}));

const { applyRefund } = await import('../../../src/services/refundService.js');

describe('refundService.applyRefund', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsRefundFullyApplied.mockReturnValue(false);
        mockGetRefundByStripeRefundId.mockResolvedValue(null);
        mockRedisSet.mockResolvedValue('OK');
        mockBeginRefundProcessing.mockResolvedValue({
            record: { stripeRefundId: 're_1' },
            alreadyCompleted: false
        });
        mockMarkRefundCompleted.mockResolvedValue({ stripeRefundId: 're_1', applicationStatus: 'completed' });
        mockGetTicketById.mockImplementation(async (id) => ({
            _id: id,
            active: false,
            paymentStatus: 'refunded',
            externalMerchantId: 'merchant_1',
            ticketInfo: { totalPrice: 25, ticketId: 'tt_1', quantity: 1 }
        }));
        mockCreateOutboxMessage.mockResolvedValue({});
        mockPublishToExchange.mockResolvedValue({});
        mockIncrementTicketTypeAvailable.mockResolvedValue({ success: true });
        mockReverseSeatPurchaseAfterRefund.mockResolvedValue({});
    });

    it('skips when refund is already fully applied', async () => {
        mockGetRefundByStripeRefundId.mockResolvedValue({ stripeRefundId: 're_1', applicationStatus: 'completed' });
        mockIsRefundFullyApplied.mockReturnValue(true);

        const result = await applyRefund({
            stripeRefundId: 're_1',
            paymentIntentId: 'pi_1',
            amount: 2500,
            status: 'succeeded'
        });

        expect(result.skipped).toBe(true);
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('invalidates ticket and restores inventory on full refund', async () => {
        mockGetTicketByPaymentIntentId.mockResolvedValue({
            _id: 'ticket_1',
            active: true,
            refundAmount: 0,
            externalMerchantId: 'merchant_1',
            event: { _id: 'event_1', externalEventId: 'evt_1', ticketInfo: [{ _id: 'tt_1', available: 0, quantity: 1 }] },
            ticketInfo: { totalPrice: 25, ticketId: 'tt_1', quantity: 1 }
        });

        const result = await applyRefund({
            stripeRefundId: 're_full',
            paymentIntentId: 'pi_1',
            amount: 2500,
            status: 'succeeded',
            source: 'dashboard'
        });

        expect(result.success).toBe(true);
        expect(result.isFullRefund).toBe(true);
        expect(mockUpdateTicketById).toHaveBeenCalledWith('ticket_1', expect.objectContaining({
            active: false,
            paymentStatus: 'refunded'
        }));
        expect(mockDeactivateChildTicketsByParentId).toHaveBeenCalledWith('ticket_1');
        expect(mockReverseSeatPurchaseAfterRefund).toHaveBeenCalled();
        expect(mockIncrementTicketTypeAvailable).toHaveBeenCalled();
        expect(mockPublishToExchange).toHaveBeenCalled();
    });

    it('records partial refund without seat or inventory reversal', async () => {
        mockGetTicketByPaymentIntentId.mockResolvedValue({
            _id: 'ticket_2',
            active: true,
            refundAmount: 0,
            externalMerchantId: 'merchant_1',
            event: { _id: 'event_1', externalEventId: 'evt_1' },
            ticketInfo: { totalPrice: 50, ticketId: 'tt_1', quantity: 1 }
        });

        const result = await applyRefund({
            stripeRefundId: 're_partial',
            paymentIntentId: 'pi_2',
            amount: 1000,
            status: 'succeeded'
        });

        expect(result.success).toBe(true);
        expect(result.isFullRefund).toBe(false);
        expect(mockUpdateTicketById).toHaveBeenCalledWith('ticket_2', expect.objectContaining({
            active: true,
            paymentStatus: 'partially_refunded'
        }));
        expect(mockDeactivateChildTicketsByParentId).not.toHaveBeenCalled();
        expect(mockReverseSeatPurchaseAfterRefund).not.toHaveBeenCalled();
        expect(mockIncrementTicketTypeAvailable).not.toHaveBeenCalled();
    });
});
