import { v4 as uuidv4 } from 'uuid';
import redisClient from '../../model/redisConnect.js';
import * as Ticket from '../../model/ticket.js';
import * as Event from '../../model/event.js';
import * as OutboxMessage from '../../model/outboxMessage.js';
import { messageConsumer } from '../../rabbitMQ/services/messageConsumer.js';
import { error, info } from '../../model/logger.js';
import { reverseSeatPurchaseAfterRefund } from './seatPurchaseFulfillmentService.js';
import {
    applyTicketQuantitiesToTicketInfo,
    findTicketTypeConfig,
    resolveSeatCountFromPurchaseMetadata
} from '../../util/ticketQuantity.js';
import {
    ticketInfoToPlain,
    resolvePaidAmountCents
} from '../../util/refundAmount.js';
import {
    getRefundByStripeRefundId,
    beginRefundProcessing,
    markRefundCompleted,
    markRefundFailed,
    appendRefundReversalErrors,
    isRefundFullyApplied
} from '../../model/refund.js';
import { publishPaymentRefunded } from '../../services/accountingEventPublisher.js';
import * as Merchant from '../../model/merchant.js';

const extractSeatMetadata = (ticketInfo) => {
    const placeIds = [];
    if (Array.isArray(ticketInfo.placeIds)) {
        placeIds.push(...ticketInfo.placeIds);
    }
    if (Array.isArray(ticketInfo.seatTickets)) {
        for (const seat of ticketInfo.seatTickets) {
            if (seat?.placeId) placeIds.push(seat.placeId);
        }
    }
    return {
        placeIds: Array.from(new Set(placeIds)),
        sectionSelections: Array.isArray(ticketInfo.sectionSelections) ? ticketInfo.sectionSelections : []
    };
};

const slimStripeEvent = (rawEvent) => {
    if (!rawEvent || typeof rawEvent !== 'object') return null;
    return {
        id: rawEvent.id,
        type: rawEvent.type,
        account: rawEvent.account || null,
    };
};

export const publishTicketRefundedEvent = async ({
    ticket,
    event,
    refund,
    inventory,
    seats
}) => {
    const correlationId = uuidv4();
    const messageId = uuidv4();
    const ticketInfo = ticketInfoToPlain(ticket.ticketInfo);
    const cleanTicket = ticket.toObject ? ticket.toObject() : { ...ticket };
    delete cleanTicket.qrCode;
    delete cleanTicket.ics;
    cleanTicket.ticketInfo = ticketInfo;
    cleanTicket.active = ticket.active;
    cleanTicket.paymentStatus = ticket.paymentStatus;
    cleanTicket.refundAmount = ticket.refundAmount;
    cleanTicket.refundedAt = ticket.refundedAt;

    if (!ticket.externalMerchantId) {
        throw new Error('externalMerchantId is required to publish TicketRefunded event');
    }

    const eventData = {
        eventType: 'TicketRefunded',
        aggregateId: String(ticket._id),
        data: {
            ticket: cleanTicket,
            externalEventId: event?.externalEventId,
            externalMerchantId: ticket.externalMerchantId,
            inventory,
            seats,
            refund
        },
        metadata: {
            correlationId,
            causationId: messageId,
            timestamp: new Date().toISOString(),
            version: 1,
            source: 'finnep-eventapp'
        }
    };

    const outboxMessageData = {
        messageId,
        exchange: 'event-merchant-exchange',
        routingKey: 'external.event.ticket.status.refunded',
        messageBody: eventData,
        headers: {
            'content-type': 'application/json',
            'message-type': 'TicketRefunded',
            'correlation-id': correlationId,
            'event-version': '1.0'
        },
        correlationId,
        eventType: 'TicketRefunded',
        aggregateId: String(ticket._id),
        status: 'pending',
        exchangeType: 'topic',
        maxRetries: 3,
        attempts: 0
    };

    await OutboxMessage.createOutboxMessage(outboxMessageData);
    await messageConsumer.publishToExchange(
        outboxMessageData.exchange,
        outboxMessageData.routingKey,
        outboxMessageData.messageBody,
        {
            headers: outboxMessageData.headers,
            correlationId
        }
    );
};

/**
 * Apply a succeeded Stripe refund to platform state (idempotent).
 */
export const applyRefund = async ({
    stripeRefundId,
    paymentIntentId,
    amount,
    currency = 'eur',
    status = 'succeeded',
    stripeChargeId = null,
    stripeAccount = null,
    source = 'unknown',
    initiatedBy = null,
    rawEvent = null,
    reason = null
}) => {
    if (!stripeRefundId || !paymentIntentId) {
        throw new Error('stripeRefundId and paymentIntentId are required');
    }

    if (status !== 'succeeded') {
        return { skipped: true, reason: 'refund_not_succeeded', status };
    }

    const existingRefund = await getRefundByStripeRefundId(stripeRefundId);
    if (isRefundFullyApplied(existingRefund)) {
        return { skipped: true, reason: 'already_processed', refund: existingRefund };
    }

    const idempotencyKey = `refund_processed:${stripeRefundId}`;
    const reserveResult = await redisClient.set(idempotencyKey, JSON.stringify({
        paymentIntentId,
        amount,
        timestamp: new Date().toISOString(),
        state: 'processing'
    }), { NX: true, EX: 86400 });

    if (reserveResult === null) {
        const existing = await getRefundByStripeRefundId(stripeRefundId);
        if (isRefundFullyApplied(existing)) {
            return { skipped: true, reason: 'already_processed', refund: existing };
        }
        throw new Error(`Refund ${stripeRefundId} is already being processed`);
    }

    const reversalErrors = [];

    try {
        const ticket = await Ticket.getTicketByPaymentIntentId(paymentIntentId);
        const beginResult = await beginRefundProcessing({
            stripeRefundId,
            stripeChargeId,
            paymentIntentId,
            amount,
            currency,
            status,
            reason,
            source,
            initiatedBy,
            stripeAccount,
            ticket: ticket?._id || null,
            event: ticket?.event?._id || ticket?.event || null,
            merchant: ticket?.merchant || null,
            rawEvent: slimStripeEvent(rawEvent),
            stripeEventId: rawEvent?.id || null,
            idempotencyKey,
        });

        if (beginResult.alreadyCompleted) {
            return { skipped: true, reason: 'already_processed', refund: beginResult.record };
        }

        if (!ticket) {
            await markRefundCompleted(stripeRefundId);
            error('[applyRefund] Refund received but no ticket found', { paymentIntentId, stripeRefundId, amount });
            try {
                await publishPaymentRefunded({
                    ticket: null,
                    event: null,
                    merchant: null,
                    stripeRefundId,
                    refundAmountCents: Number(amount || 0),
                    cumulativeRefundAmount: Number(amount || 0),
                    isFullRefund: false,
                    paymentIntentId,
                    currency,
                    orphan: true,
                    stripeAccount,
                });
            } catch (orphanPublishErr) {
                error('[applyRefund] Failed to publish orphan payment.refunded', orphanPublishErr);
            }
            return { orphan: true, refund: beginResult.record };
        }

        const event = ticket.event;
        const ticketInfo = ticketInfoToPlain(ticket.ticketInfo);
        const paidAmountCents = resolvePaidAmountCents(ticket, ticketInfo);
        const previousRefundAmount = Number(ticket.refundAmount || 0);
        const refundAmountCents = Number(amount || 0);

        if (refundAmountCents <= 0) {
            throw new Error('Refund amount must be positive');
        }

        const remainingRefundable = Math.max(0, paidAmountCents - previousRefundAmount);
        if (remainingRefundable > 0 && refundAmountCents > remainingRefundable) {
            throw new Error(`Refund amount ${refundAmountCents} exceeds remaining refundable ${remainingRefundable}`);
        }

        const cumulativeRefundAmount = previousRefundAmount + refundAmountCents;
        const isFullRefund = paidAmountCents > 0
            ? cumulativeRefundAmount >= paidAmountCents
            : cumulativeRefundAmount >= refundAmountCents;

        const paymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';

        await Ticket.updateTicketById(ticket._id, {
            active: isFullRefund ? false : ticket.active,
            paymentStatus,
            refundAmount: cumulativeRefundAmount,
            refundedAt: new Date(),
            paymentIntentId: ticket.paymentIntentId || paymentIntentId,
            paymentProvider: ticket.paymentProvider || 'stripe',
            paymentReference: ticket.paymentReference || paymentIntentId
        });

        if (isFullRefund) {
            await Ticket.deactivateChildTicketsByParentId(ticket._id);

            try {
                await reverseSeatPurchaseAfterRefund({ event, ticketInfo });
            } catch (seatErr) {
                const msg = `Seat release failed: ${seatErr.message}`;
                reversalErrors.push(msg);
                error('[applyRefund] Seat release failed after refund (ticket invalidated)', {
                    ticketId: ticket._id,
                    paymentIntentId,
                    error: seatErr.message
                });
            }

            const ticketTypeId = ticketInfo.ticketId || ticketInfo.ticket_id;
            if (ticketTypeId && event) {
                const ticketTypeConfig = findTicketTypeConfig(event, ticketTypeId);
                const seatCount = resolveSeatCountFromPurchaseMetadata(ticketInfo);
                const { quantities } = applyTicketQuantitiesToTicketInfo({}, {
                    orderQuantity: ticketInfo.orderQuantity ?? ticketInfo.quantity ?? 1,
                    ticketTypeConfig,
                    seatCount
                });
                try {
                    await Event.incrementTicketTypeAvailable(
                        event._id,
                        ticketTypeId,
                        quantities.admissionQuantity,
                        ticketTypeConfig
                    );
                } catch (inventoryErr) {
                    const msg = `Inventory restore failed: ${inventoryErr.message}`;
                    reversalErrors.push(msg);
                    error('[applyRefund] Inventory restore failed after refund', {
                        ticketId: ticket._id,
                        error: inventoryErr.message
                    });
                }
            }
        }

        const updatedTicket = await Ticket.getTicketById(ticket._id, false);
        const seats = extractSeatMetadata(ticketInfo);
        const ticketTypeId = ticketInfo.ticketId || ticketInfo.ticket_id;
        const ticketTypeConfig = event ? findTicketTypeConfig(event, ticketTypeId) : null;
        const seatCount = resolveSeatCountFromPurchaseMetadata(ticketInfo);
        const { quantities } = applyTicketQuantitiesToTicketInfo({}, {
            orderQuantity: ticketInfo.orderQuantity ?? ticketInfo.quantity ?? 1,
            ticketTypeConfig,
            seatCount
        });

        try {
            await publishTicketRefundedEvent({
                ticket: updatedTicket || ticket,
                event,
                refund: {
                    stripeRefundId,
                    amount: refundAmountCents,
                    currency,
                    source,
                    isFullRefund,
                    cumulativeRefundAmount,
                    paymentStatus
                },
                inventory: isFullRefund && ticketTypeId ? {
                    ticketTypeId,
                    admissionQuantity: quantities.admissionQuantity,
                    orderQuantity: quantities.orderQuantity,
                    packSize: quantities.packSize,
                    operation: 'increment'
                } : null,
                seats: isFullRefund ? seats : null
            });
        } catch (publishErr) {
            reversalErrors.push(`EMS publish failed: ${publishErr.message}`);
            error('[applyRefund] Failed to publish TicketRefunded event', publishErr);
        }

        try {
            const merchant = ticket.merchant ? await Merchant.getMerchantById(ticket.merchant) : null;
            await publishPaymentRefunded({
                ticket: updatedTicket || ticket,
                event,
                merchant,
                stripeRefundId,
                refundAmountCents,
                cumulativeRefundAmount,
                isFullRefund,
                paymentIntentId,
                currency,
                orphan: false,
                stripeAccount,
            });
        } catch (accountingPublishErr) {
            reversalErrors.push(`Accounting publish failed: ${accountingPublishErr.message}`);
            error('[applyRefund] Failed to publish payment.refunded event', accountingPublishErr);
        }

        if (reversalErrors.length > 0) {
            await appendRefundReversalErrors(stripeRefundId, reversalErrors);
        }

        const completedRefund = await markRefundCompleted(stripeRefundId);

        info('[applyRefund] Refund applied', {
            ticketId: ticket._id,
            paymentIntentId,
            stripeRefundId,
            isFullRefund,
            paymentStatus,
            reversalErrors
        });

        return {
            success: true,
            ticketId: ticket._id,
            isFullRefund,
            paymentStatus,
            refund: completedRefund,
            reversalErrors
        };
    } catch (err) {
        await markRefundFailed(stripeRefundId, [err.message]).catch(() => {});
        await redisClient.del(idempotencyKey).catch(() => {});
        throw err;
    }
};
