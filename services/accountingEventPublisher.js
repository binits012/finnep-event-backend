import { v4 as uuidv4 } from 'uuid';
import * as OutboxMessage from '../model/outboxMessage.js';
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js';
import { info, error } from '../model/logger.js';
import Stripe from 'stripe';
import {
    resolveOrderQuantityFromTicket,
    resolveAdmissionQuantityFromTicket,
    resolvePublishedPlatformFeeCents,
    resolvePublishedUnitPlatformFeeCents,
    readTicketInfoValue,
    PLATFORM_FEE_BASIS,
} from '../util/merchantPlatformFee.js';
import { resolveSiloCheckoutChannel } from '../util/siloCheckoutEmail.js';

const EXCHANGE = 'event-merchant-exchange';

const stripe = process.env.STRIPE_KEY ? new Stripe(process.env.STRIPE_KEY) : null;

function checkoutHostnameFromTicket(ticket) {
    const raw = ticket?.ticketInfo?.get?.('checkoutHostname') ?? ticket?.ticketInfo?.checkoutHostname;
    if (raw == null || raw === '') return null;
    return String(raw).trim().toLowerCase();
}

async function publishAccountingEvent(routingKey, data, eventType) {
    const messageId = uuidv4();
    const correlationId = uuidv4();
    const eventData = {
        eventType,
        aggregateId: data.externalPaymentId || data.stripeRefundId || data.eventId || messageId,
        data,
        metadata: {
            messageId,
            correlationId,
            timestamp: new Date().toISOString(),
            version: 1,
            source: 'finnep-eventapp-backend'
        }
    };

    const outboxMessageData = {
        messageId,
        exchange: EXCHANGE,
        routingKey,
        messageBody: eventData,
        headers: {
            'content-type': 'application/json',
            'message-type': eventType,
            'correlation-id': correlationId,
            'event-version': '1.0'
        },
        correlationId,
        eventType,
        aggregateId: eventData.aggregateId,
        status: 'pending',
        exchangeType: 'topic',
        maxRetries: 3,
        attempts: 0
    };

    try {
        const saved = await OutboxMessage.createOutboxMessage(outboxMessageData);
        await messageConsumer.publishToExchange(
            EXCHANGE,
            routingKey,
            eventData,
            {
                headers: outboxMessageData.headers,
                correlationId,
                exchangeType: 'topic',
            }
        );
        await OutboxMessage.markMessageAsSent(saved._id);
        info('[accountingEventPublisher] Published %s messageId=%s', routingKey, messageId);
    } catch (err) {
        error('[accountingEventPublisher] Failed to publish %s: %s', routingKey, err?.message || err);
    }
}

function resolveRegion(merchant, event) {
    const country = (merchant?.country || event?.country || 'eu').toLowerCase();
    if (country === 'au' || country === 'australia') return 'au';
    if (country === 'np' || country === 'nepal') return 'np';
    return 'eu';
}

function centsFromMajor(amount) {
    const n = Number(amount || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

/**
 * @param {object} params
 * @param {object} params.ticket — ticket document; all qty/fee fields read from ticketInfo only
 */
export async function publishPaymentCompleted({
    ticket,
    event,
    merchant,
    method,
    externalPaymentId,
    grossCents,
    pspFeeCents = 0,
    checkoutChannel = 'marketplace',
    currency = 'eur',
    completedAt = new Date().toISOString()
}) {
    const normalizedMethod = (method || 'stripe').toLowerCase();
    const orderQuantity = resolveOrderQuantityFromTicket(ticket);
    const admissionQuantity = resolveAdmissionQuantityFromTicket(ticket);
    const unitPlatformFeeCents = resolvePublishedUnitPlatformFeeCents(ticket, merchant);
    const platformFeeCents = resolvePublishedPlatformFeeCents(ticket, merchant, {
        grossCents,
        method: normalizedMethod,
    });
    const platformFeeBasis = readTicketInfoValue(ticket, 'platformFeeBasis') || (
        platformFeeCents > 0 && (normalizedMethod === 'stripe') ? PLATFORM_FEE_BASIS : null
    );
    const configuredPlatformFeeUnitCents = readTicketInfoValue(ticket, 'platformFeeUnitCents')
        ?? (unitPlatformFeeCents > 0 ? String(unitPlatformFeeCents) : null);

    const merchantNet = Math.max(0, grossCents - platformFeeCents - pspFeeCents);
    await publishAccountingEvent('payment.completed', {
        platformMerchantId: merchant?.merchantId || ticket?.externalMerchantId,
        febMerchantId: merchant?._id?.toString?.() || ticket?.merchant?.toString?.(),
        emsMerchantId: ticket?.externalMerchantId || merchant?.merchantId,
        eventId: event?._id?.toString?.() || ticket?.event?.toString?.(),
        eventTitle: event?.eventTitle || event?.eventName || null,
        ticketIds: ticket?._id ? [String(ticket._id)] : [],
        grossCents,
        platformFeeCents,
        ...(platformFeeBasis ? { platformFeeBasis } : {}),
        ...(orderQuantity != null ? { orderQuantity } : {}),
        ...(admissionQuantity != null ? { admissionQuantity } : {}),
        configuredPlatformFeeCents: configuredPlatformFeeUnitCents != null
            ? Number(configuredPlatformFeeUnitCents) || null
            : null,
        pspFeeCents,
        merchantNetCents: merchantNet,
        method: normalizedMethod,
        currency: (currency || 'eur').toLowerCase(),
        externalPaymentId: String(externalPaymentId),
        checkoutChannel,
        completedAt,
        region: resolveRegion(merchant, event)
    }, 'PaymentCompleted');
}

export async function fetchPlatformFeeReversedCents(stripeRefundId, stripeAccount = null) {
    if (!stripe || !stripeRefundId) return { platformFeeReversedCents: 0, feeReversalEstimated: true };
    try {
        const opts = stripeAccount ? { stripeAccount } : {};
        const refund = await stripe.refunds.retrieve(stripeRefundId, opts);
        const feeRefund = refund?.application_fee_refund || refund?.application_fee_amount_refunded;
        if (feeRefund != null) {
            return { platformFeeReversedCents: Number(feeRefund), feeReversalEstimated: false };
        }
    } catch (err) {
        error('[accountingEventPublisher] Stripe fee reversal fetch failed: %s', err?.message);
    }
    return { platformFeeReversedCents: 0, feeReversalEstimated: true };
}

export async function publishPaymentRefunded({
    ticket,
    event,
    merchant,
    stripeRefundId,
    refundAmountCents,
    cumulativeRefundAmount,
    isFullRefund,
    paymentIntentId,
    currency = 'eur',
    orphan = false,
    platformFeeReversedCents = 0,
    feeReversalEstimated = false,
    stripeAccount = null,
    checkoutChannel = null,
}) {
    let feeReversed = platformFeeReversedCents;
    let estimated = feeReversalEstimated;
    if (!feeReversed && stripeRefundId) {
        const fetched = await fetchPlatformFeeReversedCents(stripeRefundId, stripeAccount);
        feeReversed = fetched.platformFeeReversedCents;
        estimated = fetched.feeReversalEstimated;
        if (estimated && ticket) {
            const paid = centsFromMajor(ticket?.ticketInfo?.get?.('price') ?? ticket?.ticketInfo?.price);
            const origFee = resolvePublishedPlatformFeeCents(ticket, merchant, {
                grossCents: paid,
                method: 'stripe',
            });
            if (paid > 0 && origFee > 0) {
                feeReversed = Math.round(origFee * (refundAmountCents / paid));
            }
        }
    }

    await publishAccountingEvent('payment.refunded', {
        platformMerchantId: merchant?.merchantId || ticket?.externalMerchantId,
        febMerchantId: merchant?._id?.toString?.() || ticket?.merchant?.toString?.(),
        emsMerchantId: ticket?.externalMerchantId || merchant?.merchantId,
        eventId: event?._id?.toString?.() || ticket?.event?.toString?.(),
        eventTitle: event?.eventTitle || event?.eventName || null,
        ticketId: ticket?._id?.toString?.(),
        stripeRefundId,
        refundAmountCents,
        cumulativeRefundAmount,
        isFullRefund,
        platformFeeReversedCents: feeReversed,
        feeReversalEstimated: estimated,
        paymentIntentId,
        currency: (currency || 'eur').toLowerCase(),
        orphan,
        refundedAt: new Date().toISOString(),
        region: resolveRegion(merchant, event),
        checkoutChannel: checkoutChannel || resolveSiloCheckoutChannel(merchant, checkoutHostnameFromTicket(ticket)),
    }, 'PaymentRefunded');
}

export async function publishAccountingExternalSales(saleData, messageId) {
    await publishAccountingEvent('accounting.external.sales', {
        ...saleData,
        messageId
    }, 'AccountingExternalSales');
}
