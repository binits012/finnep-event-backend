import { applyRefund } from '../src/services/refundService.js';
import { error, info } from '../model/logger.js';

const extractPaymentIntentId = (refund) => {
    if (refund?.payment_intent) {
        return typeof refund.payment_intent === 'string'
            ? refund.payment_intent
            : refund.payment_intent?.id;
    }
    return null;
};

const extractPaymentIntentIdFromCharge = (charge) => {
    if (charge?.payment_intent) {
        return typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;
    }
    return null;
};

const normalizeRefundUpdatedPayload = (event) => {
    if (event?.type !== 'refund.updated') {
        return null;
    }

    const refund = event.data?.object;
    if (!refund?.id || !refund.id.startsWith('re_')) {
        return null;
    }

    return {
        stripeRefundId: refund.id,
        paymentIntentId: extractPaymentIntentId(refund),
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        stripeChargeId: typeof refund.charge === 'string' ? refund.charge : refund.charge?.id,
        stripeAccount: event?.account || null,
        reason: refund.reason,
        rawEvent: event,
        source: 'dashboard'
    };
};

/**
 * Secondary reconciliation hook — canonical processing uses refund.updated.
 */
export const handleChargeRefundedWebhookEvent = async (event) => {
    const charge = event?.data?.object;
    const paymentIntentId = extractPaymentIntentIdFromCharge(charge);

    info('[stripeRefundWebhook] charge.refunded received (reconciliation log)', {
        chargeId: charge?.id,
        paymentIntentId,
        amountRefunded: charge?.amount_refunded,
        refunded: charge?.refunded,
        stripeAccount: event?.account || null,
        eventId: event?.id
    });

    return {
        logged: true,
        paymentIntentId,
        amountRefunded: charge?.amount_refunded ?? null
    };
};

export const handleStripeRefundWebhookEvent = async (event) => {
    if (event?.type === 'charge.refunded') {
        return handleChargeRefundedWebhookEvent(event);
    }

    const payload = normalizeRefundUpdatedPayload(event);
    if (!payload) {
        info('[stripeRefundWebhook] Ignored non-canonical refund event', {
            type: event?.type,
            id: event?.id
        });
        return { skipped: true, reason: 'ignored_event_type' };
    }

    if (!payload.paymentIntentId) {
        info('[stripeRefundWebhook] Skipping refund without payment intent', {
            type: event?.type,
            stripeRefundId: payload.stripeRefundId
        });
        return { skipped: true, reason: 'missing_payment_intent' };
    }

    if (payload.status !== 'succeeded') {
        info('[stripeRefundWebhook] Refund not yet succeeded', {
            stripeRefundId: payload.stripeRefundId,
            status: payload.status
        });
        return { skipped: true, reason: 'refund_not_succeeded', status: payload.status };
    }

    try {
        const result = await applyRefund(payload);
        info('[stripeRefundWebhook] Processed refund webhook', {
            type: event.type,
            stripeRefundId: payload.stripeRefundId,
            paymentIntentId: payload.paymentIntentId,
            result
        });
        return result;
    } catch (err) {
        error('[stripeRefundWebhook] Failed to process refund webhook', {
            type: event?.type,
            stripeRefundId: payload.stripeRefundId,
            error: err.message,
            stack: err.stack
        });
        throw err;
    }
};
