import * as Ticket from '../model/ticket.js';
import * as Event from '../model/event.js';
import * as Merchant from '../model/merchant.js';
import * as hash from '../util/createHash.js';
import * as ticketMaster from '../util/ticketMaster.js';
import { attachCouponFieldsToTicketInfo, enrichMetadataWithCouponPricing } from '../util/ticketDiscountDisplay.js';
import * as commonUtil from '../util/common.js';
import redisClient from '../model/redisConnect.js';
import { info, error } from '../model/logger.js';
import * as consts from '../const.js';
import { buildSiloTicketEmailOptionsFromPaymentData, resolveSiloCheckoutChannel } from '../util/siloCheckoutEmail.js';
import { publishTicketCreationEvent } from './front.controller.js';
import { publishPaymentCompleted, resolvePlatformFeeCents } from '../services/accountingEventPublisher.js';
import {
    applyTicketQuantitiesToTicketInfo,
    findTicketTypeConfig,
    getScanCountFromTicketType,
    validateScanCountOrderQuantity,
    validateTicketPurchaseInventory
} from '../util/ticketQuantity.js';
import { PlatformMarketingConsent } from '../model/mongoModel.js';
import { fulfillSeatPurchaseBeforeTicket } from '../src/services/seatPurchaseFulfillmentService.js';

export const handlePaytrailWebhook = async (req, res, next) => {
    try {
        const paytrailService = (await import('../services/paytrailService.js')).default;

        // Extract signature from headers
        const signature = req.headers['signature'];
        const params = req.query;

        // Verify webhook signature
        if (!paytrailService.verifyWebhookSignature(params, signature)) {
            error('Invalid Paytrail webhook signature');
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                error: 'Invalid signature'
            });
        }

        const {
            'checkout-status': status,
            'checkout-transaction-id': transactionId,
            'checkout-stamp': stamp,
            'checkout-reference': reference,
            'checkout-provider': provider
        } = params;

        // Log all webhook parameters for debugging
        info(`Paytrail webhook received - Status: ${status}, Transaction: ${transactionId}, Stamp: ${stamp}, Provider: ${provider || 'N/A'}`);

        // Get payment metadata from Redis
        const paymentKey = `paytrail_payment:${stamp}`;
        const paymentDataStr = await redisClient.get(paymentKey);

        if (!paymentDataStr) {
            error(`Payment data not found for stamp: ${stamp}`);
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                error: 'Payment not found'
            });
        }

        const paymentData = JSON.parse(paymentDataStr);

        // Stamp format: M{merchantId}-E{eventId}-T{ticketId}-{timestamp}
        // Extract merchant ID from stamp if subMerchantId is null (single account mode)
        if (!paymentData.subMerchantId && paymentData.stamp) {
            const stampMatch = paymentData.stamp.match(/^M([^-]+)-/);
            if (stampMatch && !paymentData.merchantId) {
                // Merchant ID is already in paymentData from Redis, but verify
                // This is just for logging/debugging
            }
        }

        if (status === 'ok') {
            // Payment successful - create ticket (idempotent)
            info(`Processing successful Paytrail payment: ${transactionId} for stamp: ${stamp}`);

            // Check if ticket already exists (idempotency)
            const existingTicket = await Ticket.genericSearch({ paytrailStamp: stamp });
            if (existingTicket) {
                info(`Ticket already exists for Paytrail payment (webhook duplicate): ${transactionId} - skipping creation`);
            } else {
                await createTicketFromPaytrailPayment(paymentData, transactionId, stamp);
                // Update merchant Paytrail statistics (idempotent - uses $inc)
                await updateMerchantPaytrailStats(paymentData.merchantId, paymentData.amount / 100);
            }

            // Delete payment data from Redis (safe to delete even if ticket exists)
            await redisClient.del(paymentKey);

            if (paymentData.isShopInShop) {
                info(`Paytrail shop-in-shop payment successful: ${transactionId} (sub-merchant: ${paymentData.subMerchantId})`);
            } else {
                info(`Paytrail single account payment successful: ${transactionId} (merchant: ${paymentData.merchantId})`);
            }
        } else {
            // Payment failed or cancelled
            error(`Paytrail payment failed/cancelled - Status: ${status}, Transaction: ${transactionId}, Stamp: ${stamp}, Provider: ${provider || 'N/A'}`);
            info(`Paytrail payment cancelled/failed: ${transactionId} - Status: ${status}`);

            // Optionally clean up Redis entry for failed payments after some time
            // For now, we keep it so the frontend can verify the failure
        }

        res.status(consts.HTTP_STATUS_OK).json({ received: true, status: status });

    } catch (err) {
        error('Error handling Paytrail webhook:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: 'Webhook processing failed'
        });
    }
};

export async function createTicketFromPaytrailPayment(paymentData, transactionId, stamp) {
    // Idempotency check: Check if ticket already exists for this stamp
    const existingTicket = await Ticket.genericSearch({ paytrailStamp: stamp });
    if (existingTicket) {
        info(`Ticket already exists for Paytrail payment stamp: ${stamp} (transaction: ${transactionId}) - skipping creation and email`);
        return existingTicket;
    }

    // Also check by transaction ID for additional idempotency
    if (transactionId) {
        const existingByTransaction = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
        if (existingByTransaction) {
            info(`Ticket already exists for Paytrail transaction: ${transactionId} - skipping creation and email`);
            return existingByTransaction;
        }
    }

    const ticketLockKey = `paytrail_ticket_create_lock:${stamp}`;
    const ticketLockAcquired = await redisClient.set(ticketLockKey, transactionId || stamp, {
        NX: true,
        EX: 60
    });
    if (ticketLockAcquired === null) {
        for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const inProgressTicket = await Ticket.genericSearch({ paytrailStamp: stamp })
                || (transactionId ? await Ticket.genericSearch({ paytrailTransactionId: transactionId }) : null);
            if (inProgressTicket) {
                info(`Ticket created by parallel Paytrail request for stamp: ${stamp}`);
                return inProgressTicket;
            }
        }
        const err = new Error('Ticket creation already in progress for this payment');
        err.code = 'TICKET_CREATION_IN_PROGRESS';
        throw err;
    }

    try {
        return await _createTicketFromPaytrailPaymentBody(paymentData, transactionId, stamp);
    } finally {
        await redisClient.del(ticketLockKey).catch(() => {});
    }
}

async function _createTicketFromPaytrailPaymentBody(paymentData, transactionId, stamp) {
    const existingTicket = await Ticket.genericSearch({ paytrailStamp: stamp });
    if (existingTicket) {
        return existingTicket;
    }
    if (transactionId) {
        const existingByTransaction = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
        if (existingByTransaction) {
            return existingByTransaction;
        }
    }

    const placeIds = paymentData.placeIds || paymentData.seats || [];
    const seatTickets = Array.isArray(paymentData.seatTickets) ? paymentData.seatTickets : (paymentData.seatTickets ? (typeof paymentData.seatTickets === 'string' ? (() => { try { return JSON.parse(paymentData.seatTickets); } catch { return []; } })() : []) : []);

    console.log('[createTicketFromPaytrailPayment] Payment data received:', {
        hasBasePrice: !!paymentData.basePrice,
        hasServiceFee: !!paymentData.serviceFee,
        basePrice: paymentData.basePrice,
        serviceFee: paymentData.serviceFee,
        vatAmount: paymentData.vatAmount,
        amount: paymentData.amount,
        hasSeatTickets: !!seatTickets.length,
        seatTicketsLength: seatTickets.length,
        placeIdsLength: placeIds.length
    });

    const otp = await commonUtil.createCode(8);

    // Load event for venue info (same structure as Stripe ticketInfo)
    const event = await Event.getEventById(paymentData.eventId);

    const paidAmount = paymentData.amount / 100;
    const ticketInfoDraft = {
        eventName: paymentData.eventName,
        ticketName: paymentData.ticketName,
        price: paidAmount,
        totalPrice: paidAmount,
        totalAmount: paidAmount,
        currency: 'EUR',
        purchaseDate: new Date().toISOString(),
        paytrailTransactionId: transactionId,
        paytrailStamp: stamp,
        paytrailSubMerchantId: paymentData.subMerchantId,
        email: paymentData.email,
        merchantId: paymentData.merchantId,
        eventId: paymentData.eventId,
        ticketId: paymentData.ticketId,
        paymentProvider: 'paytrail',
        // Include commission details
        platformCommission: paymentData.commission,
        // Pricing breakdown (from Redis/frontend data)
        basePrice: paymentData.basePrice ? parseFloat(paymentData.basePrice) : undefined,
        serviceFee: paymentData.serviceFee ? parseFloat(paymentData.serviceFee) : undefined,
        vatRate: paymentData.vatRate ? parseFloat(paymentData.vatRate) : undefined,
        vatAmount: paymentData.vatAmount ? parseFloat(paymentData.vatAmount) : undefined,
        serviceTax: paymentData.serviceTax ? parseFloat(paymentData.serviceTax) : undefined,
        serviceTaxAmount: paymentData.serviceTaxAmount ? parseFloat(paymentData.serviceTaxAmount) : undefined,
        entertainmentTax: paymentData.entertainmentTax ? parseFloat(paymentData.entertainmentTax) : undefined,
        entertainmentTaxAmount: paymentData.entertainmentTaxAmount ? parseFloat(paymentData.entertainmentTaxAmount) : undefined,
        orderFee: paymentData.orderFee ? parseFloat(paymentData.orderFee) : undefined,
        orderFeeServiceTax: paymentData.orderFeeServiceTax ? parseFloat(paymentData.orderFeeServiceTax) : undefined,
        totalBasePrice: paymentData.totalBasePrice ? parseFloat(paymentData.totalBasePrice) : undefined,
        totalServiceFee: paymentData.totalServiceFee ? parseFloat(paymentData.totalServiceFee) : undefined,
        country: paymentData.country,
        fullName: paymentData.fullName,
        placeIds,
        // seatTickets: same as Stripe - array of { placeId, ticketId, ticketName } for display
        seatTickets
    };

    // Add venue (same structure as Stripe) so ticket display is consistent
    if (event && event.venue) {
        ticketInfoDraft.venue = {
            venueId: event.venue.venueId || null,
            externalVenueId: event.venue.externalVenueId || null,
            venueName: event.venue.name || null,
            hasSeatSelection: !!event.venue.venueId
        };
    }

    // Add seats array (same structure as Stripe) for seat-based events
    if (event && event.venue && event.venue.venueId && placeIds.length > 0) {
        ticketInfoDraft.seats = placeIds.map(placeId => ({ placeId }));
    }

    const ticketTypeConfig = findTicketTypeConfig(event, paymentData.ticketId);
    const enrichedPaymentData = enrichMetadataWithCouponPricing(
        { ...paymentData, quantity: paymentData.quantity },
        event,
        ticketTypeConfig
    );
    attachCouponFieldsToTicketInfo(ticketInfoDraft, enrichedPaymentData);
    const seatCount = Math.max(placeIds.length, seatTickets.length);

    let inventoryAdmissionQuantity = null;
    if (ticketTypeConfig && event && paymentData.ticketId) {
        const inventoryCheck = validateTicketPurchaseInventory(event, ticketTypeConfig, {
            orderQuantity: paymentData.quantity,
            seatCount,
            metadata: paymentData
        });
        inventoryAdmissionQuantity = inventoryCheck.admissionQuantity;
    }

    const scanCount = getScanCountFromTicketType(ticketTypeConfig);
    const scanValidation = validateScanCountOrderQuantity(paymentData.quantity, scanCount);
    if (!scanValidation.valid) {
        throw new Error(scanValidation.error);
    }
    const { ticketInfo, quantities } = applyTicketQuantitiesToTicketInfo(ticketInfoDraft, {
        orderQuantity: paymentData.quantity,
        ticketTypeConfig,
        seatCount
    });

    const emailCrypto = await hash.getCryptoBySearchIndex(paymentData.email, 'email');
    let emailHash = emailCrypto.length > 0 ? emailCrypto[0]._id : (await hash.createHashData(paymentData.email, 'email'))._id;

    // Platform marketing: default opt-in for every new email
    await PlatformMarketingConsent.getOrCreatePlatformConsent(emailHash);

    const isVenueEvent = !!(event && event.venue && event.venue.venueId);
    if (isVenueEvent) {
        await fulfillSeatPurchaseBeforeTicket({
            eventId: paymentData.eventId,
            event,
            sessionId: paymentData.sessionId,
            placeIds,
            sectionSelections: paymentData.sectionSelections,
            checkoutToken: paymentData.checkoutToken || null,
            logPrefix: '[createTicketFromPaytrailPayment]',
        });
    }

    if (ticketTypeConfig && paymentData.ticketId && inventoryAdmissionQuantity != null) {
        const inventoryDecrement = await Event.decrementTicketTypeAvailable(
            event._id,
            paymentData.ticketId,
            inventoryAdmissionQuantity,
            ticketTypeConfig
        );
        if (!inventoryDecrement.success) {
            if (isVenueEvent) {
                error(`[createTicketFromPaytrailPayment] Ticket type inventory drift after seat fulfillment (continuing to honor paid seats)`, {
                    eventId: paymentData.eventId,
                    ticketId: paymentData.ticketId,
                    admissionQuantity: inventoryAdmissionQuantity,
                    reason: inventoryDecrement.reason,
                    stamp,
                });
            } else {
                const err = new Error('INSUFFICIENT_TICKET_INVENTORY');
                err.code = 'INSUFFICIENT_TICKET_INVENTORY';
                throw err;
            }
        }
    }

    let ticket = await Ticket.createTicket(
        null,
        emailHash,
        paymentData.eventId,
        paymentData.ticketName,
        ticketInfo,
        otp,
        paymentData.merchantId,
        paymentData.externalMerchantId
    );

    await ticketMaster.provisionGroupChildQRCodes(
        ticket,
        event,
        quantities.admissionQuantity,
        {
            eventId: paymentData.eventId,
            merchantId: paymentData.merchantId,
            externalMerchantId: paymentData.externalMerchantId
        }
    );
    ticket = await Ticket.getTicketById(ticket._id, false);

    // Update ticket with Paytrail fields
    // subMerchantId can be null in single account mode
    await Ticket.updateTicketById(ticket._id, {
        paymentProvider: 'paytrail',
        paytrailTransactionId: transactionId,
        paytrailStamp: stamp,
        paytrailSubMerchantId: paymentData.subMerchantId || null
    });

    // Queue ticket email via BullMQ (non-blocking, with retries)
    // Only queue email if ticket was just created (not existing) and email hasn't been sent yet
    // event already loaded above for ticketInfo.venue / ticketInfo.seats

    if (!ticket.isSend) {
        const { normalizeLocale } = await import('../util/common.js');
        const locale = paymentData.locale ? normalizeLocale(paymentData.locale) : 'en-US';
        const merchant = await Merchant.getMerchantById(paymentData.merchantId);
        const emailOptions = buildSiloTicketEmailOptionsFromPaymentData(merchant, paymentData);
        
        // Log silo email decision for debugging
        const isSiloEmail = emailOptions.channel === 'silo';
        const logContext = `ticketId=${ticket._id}, merchantId=${paymentData.merchantId}, checkoutHostname=${paymentData.checkoutHostname}, isSiloEmail=${isSiloEmail}`;
        info(`[createTicketFromPaytrailPayment] Email options resolved: ${logContext}`);
        
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, paymentData.email, otp, locale, emailOptions);

        try {
            await ticketMaster.queueTicketEmailDelivery(ticket._id.toString(), emailPayload, emailOptions);
            info(`Email queued for ticket: ${ticket._id}`);
        } catch (queueError) {
            // Don't fail ticket creation if queue fails - log and continue
            error(`Failed to queue email for ticket: ${ticket._id}`, { error: queueError.message });
        }
    } else {
        info(`Email already sent for ticket: ${ticket._id} - skipping email queue`);
    }

    // Publish ticket creation event to RabbitMQ (same as Stripe and free events)
    try {
        await publishTicketCreationEvent(ticket, event, paymentData, transactionId);
        info(`Ticket creation event published to RabbitMQ for ticket: ${ticket._id}`);
    } catch (publishError) {
        error(`Failed to publish ticket creation event for ticket: ${ticket._id}`, { error: publishError.message });
        // Don't fail the entire operation if event publishing fails
    }

    try {
        const merchant = await Merchant.getMerchantById(paymentData.merchantId);
        const grossCents = Number(paymentData.amount || 0);
        const platformFeeCents = resolvePlatformFeeCents({
            method: 'paytrail',
            grossCents,
            commission: paymentData.commission,
            commissionRate: paymentData.commissionRate,
        });
        await publishPaymentCompleted({
            ticket,
            event,
            merchant,
            method: 'paytrail',
            externalPaymentId: transactionId,
            grossCents,
            platformFeeCents,
            pspFeeCents: 0,
            checkoutChannel: resolveSiloCheckoutChannel(merchant, paymentData.checkoutHostname),
            currency: 'eur',
        });
    } catch (accountingErr) {
        error(`Failed to publish accounting payment.completed for ticket: ${ticket._id}`, { error: accountingErr.message });
    }

    info(`Ticket created for Paytrail payment: ${ticket._id} (transaction: ${transactionId}, stamp: ${stamp})`);
    return ticket;
}

export async function updateMerchantPaytrailStats(merchantId, amount) {
    try {
        const merchant = await Merchant.getMerchantById(merchantId);
        if (!merchant) return;

        await Merchant.updateMerchantById(merchantId, {
            'paytrailShopInShopData.lastPaytrailPaymentDate': new Date(),
            $inc: {
                'paytrailShopInShopData.totalPaytrailTransactions': 1,
                'paytrailShopInShopData.totalPaytrailRevenue': amount
            }
        });
    } catch (err) {
        error('Error updating merchant Paytrail stats:', err);
        // Non-critical, don't throw
    }
}
