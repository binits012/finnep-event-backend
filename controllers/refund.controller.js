import Stripe from 'stripe';
import * as consts from '../const.js';
import * as Ticket from '../model/ticket.js';
import * as Merchant from '../model/merchant.js';
import * as RefundModel from '../model/refund.js';
import { applyRefund } from '../src/services/refundService.js';
import { isPlatformStripeAccount } from '../util/stripePlatform.js';
import {
    computeRemainingRefundableCents,
    mapToStripeRefundReason
} from '../util/refundAmount.js';
import { error } from '../model/logger.js';

const stripe = new Stripe(process.env.STRIPE_KEY);

const ticketInfoToPlain = (ticketInfo) => {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo);
    return typeof ticketInfo === 'object' ? ticketInfo : {};
};

const resolvePaymentIntentId = (ticket) => {
    return ticket.paymentIntentId
        || ticket.paymentReference
        || ticketInfoToPlain(ticket.ticketInfo).paymentIntentId
        || null;
};

const assertMerchantOwnsTicket = (ticket, externalMerchantId) => {
    if (!externalMerchantId) {
        const err = new Error('externalMerchantId is required');
        err.statusCode = consts.HTTP_STATUS_BAD_REQUEST;
        throw err;
    }
    const ticketMerchantId = String(ticket.externalMerchantId || '');
    if (ticketMerchantId && ticketMerchantId !== String(externalMerchantId)) {
        const err = new Error('Ticket does not belong to the specified merchant');
        err.statusCode = consts.HTTP_STATUS_SERVICE_FORBIDDEN;
        throw err;
    }
};

export const refundTicket = async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { reason, amount, externalMerchantId } = req.body || {};
        const initiatedBy = req.body?.initiatedBy || req.headers['x-initiated-by'] || 'internal';

        const ticket = await Ticket.getTicketById(ticketId, false);
        if (!ticket) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ success: false, error: 'Ticket not found' });
        }

        try {
            assertMerchantOwnsTicket(ticket, externalMerchantId);
        } catch (authErr) {
            return res.status(authErr.statusCode || consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: authErr.message
            });
        }

        if (ticket.paymentStatus === 'refunded') {
            return res.status(consts.HTTP_STATUS_CONFLICT).json({ success: false, error: 'Ticket already fully refunded' });
        }

        if (ticket.active === false) {
            return res.status(consts.HTTP_STATUS_CONFLICT).json({ success: false, error: 'Ticket is not active' });
        }

        const provider = ticket.paymentProvider || 'stripe';
        if (provider !== 'stripe') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: `Refunds for ${provider} are not supported via this API`
            });
        }

        const paymentIntentId = resolvePaymentIntentId(ticket);
        if (!paymentIntentId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: 'No Stripe payment intent found for this ticket'
            });
        }

        const remainingRefundable = computeRemainingRefundableCents(ticket);
        if (remainingRefundable <= 0) {
            return res.status(consts.HTTP_STATUS_CONFLICT).json({
                success: false,
                error: 'No refundable amount remaining for this ticket'
            });
        }

        let refundAmountCents = remainingRefundable;
        if (amount != null && Number(amount) > 0) {
            refundAmountCents = Math.round(Number(amount));
            if (refundAmountCents > remainingRefundable) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    success: false,
                    error: `Refund amount exceeds remaining refundable balance (${remainingRefundable} cents)`
                });
            }
        }

        const merchant = ticket.merchant
            ? await Merchant.getMerchantById(ticket.merchant)
            : await Merchant.getMerchantByMerchantId(ticket.externalMerchantId);

        const stripeOptions = {};
        if (merchant?.stripeAccount && !isPlatformStripeAccount(merchant.stripeAccount)) {
            stripeOptions.stripeAccount = merchant.stripeAccount;
        }

        const refundParams = {
            payment_intent: paymentIntentId,
            refund_application_fee: true,
            amount: refundAmountCents
        };
        const stripeReason = mapToStripeRefundReason(reason);
        if (stripeReason) refundParams.reason = stripeReason;

        const stripeRefund = await stripe.refunds.create(refundParams, stripeOptions);

        let applyResult = null;
        if (stripeRefund.status === 'succeeded') {
            applyResult = await applyRefund({
                stripeRefundId: stripeRefund.id,
                paymentIntentId,
                amount: stripeRefund.amount,
                currency: stripeRefund.currency,
                status: stripeRefund.status,
                stripeChargeId: typeof stripeRefund.charge === 'string' ? stripeRefund.charge : stripeRefund.charge?.id,
                stripeAccount: stripeOptions.stripeAccount || null,
                source: 'api',
                initiatedBy,
                rawEvent: stripeRefund,
                reason: reason || stripeReason
            });
        }

        const httpStatus = stripeRefund.status === 'pending'
            ? consts.HTTP_STATUS_ACCEPTED
            : consts.HTTP_STATUS_OK;

        return res.status(httpStatus).json({
            success: true,
            status: stripeRefund.status,
            platformApplied: applyResult?.success === true,
            refund: {
                id: stripeRefund.id,
                amount: stripeRefund.amount,
                currency: stripeRefund.currency,
                status: stripeRefund.status
            },
            applyResult
        });
    } catch (err) {
        error('[refundTicket] %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            error: err.message || 'Refund failed'
        });
    }
};

export const listEventRefunds = async (req, res) => {
    try {
        const { eventId } = req.params;
        const skip = Number(req.query.skip || 0);
        const limit = Math.min(Number(req.query.limit || 50), 200);
        const refunds = await RefundModel.listRefundsByEventId(eventId, { skip, limit });
        const totals = await RefundModel.aggregateRefundsByEventId(eventId);
        return res.status(consts.HTTP_STATUS_OK).json({ success: true, refunds, totals });
    } catch (err) {
        error('[listEventRefunds] %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            error: err.message
        });
    }
};
