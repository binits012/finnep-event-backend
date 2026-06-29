import * as Ticket from '../model/ticket.js';
import * as Event from '../model/event.js';
import * as Merchant from '../model/merchant.js';
import * as hash from '../util/createHash.js';
import * as ticketMaster from '../util/ticketMaster.js';
import * as commonUtil from '../util/common.js';
import redisClient from '../model/redisConnect.js';
import { info, error } from '../model/logger.js';
import * as consts from '../const.js';
import { resolveSiloCheckoutChannel } from '../util/siloCheckoutEmail.js';
import { queueTicketEmail } from '../workers/emailWorker.js';
import { publishTicketCreationEvent } from './front.controller.js';
import { publishPaymentCompleted } from '../services/accountingEventPublisher.js';
import {
    applyTicketQuantitiesToTicketInfo,
    findTicketTypeConfig,
    getScanCountFromTicketType,
    validateScanCountOrderQuantity,
    validateTicketPurchaseInventory
} from '../util/ticketQuantity.js';
import { PlatformMarketingConsent } from '../model/mongoModel.js';

export const handleNabilWebhook = async (req, res) => {
    try {
        const nabilService = (await import('../services/nabilPaymentService.js')).default;
        const signature = req.headers['signature'] || req.headers['x-signature'];
        const params = { ...req.query, ...req.body };

        if (!nabilService.sandboxMode && !nabilService.verifyWebhookSignature(params, signature)) {
            error('Invalid Nabil webhook signature');
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({ error: 'Invalid signature' });
        }

        const status = String(params.status || params.paymentStatus || '').toLowerCase();
        const transactionId = params.transactionId || params.transaction_id;
        const stamp = params.stamp || params.orderId;

        if (!stamp) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Missing stamp' });
        }

        info(`Nabil webhook received - status=${status}, transaction=${transactionId}, stamp=${stamp}`);

        const paymentKey = `nabil_payment:${stamp}`;
        const paymentDataStr = await redisClient.get(paymentKey);

        if (!paymentDataStr) {
            error(`Nabil payment data not found for stamp: ${stamp}`);
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: 'Payment not found' });
        }

        const paymentData = JSON.parse(paymentDataStr);

        if (status === 'ok' || status === 'success' || status === 'paid') {
            const existingTicket = await Ticket.genericSearch({ nabilStamp: stamp });
            if (!existingTicket) {
                await createTicketFromNabilPayment(paymentData, transactionId, stamp);
            }
            await redisClient.del(paymentKey);
        }

        return res.status(consts.HTTP_STATUS_OK).json({ received: true, status });
    } catch (err) {
        error('Error handling Nabil webhook:', err);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: 'Webhook processing failed' });
    }
};

export async function createTicketFromNabilPayment(paymentData, transactionId, stamp) {
    const existingTicket = await Ticket.genericSearch({ nabilStamp: stamp });
    if (existingTicket) {
        return existingTicket;
    }
    if (transactionId) {
        const existingByTxn = await Ticket.genericSearch({ nabilTransactionId: transactionId });
        if (existingByTxn) {
            return existingByTxn;
        }
    }

    const lockKey = `nabil_ticket_create_lock:${stamp}`;
    const lockAcquired = await redisClient.set(lockKey, transactionId || stamp, { NX: true, EX: 60 });
    if (lockAcquired === null) {
        for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const inProgress = await Ticket.genericSearch({ nabilStamp: stamp })
                || (transactionId ? await Ticket.genericSearch({ nabilTransactionId: transactionId }) : null);
            if (inProgress) return inProgress;
        }
        const err = new Error('Ticket creation already in progress for this Nabil payment');
        err.code = 'TICKET_CREATION_IN_PROGRESS';
        throw err;
    }

    try {
        return await _createTicketFromNabilPaymentBody(paymentData, transactionId, stamp);
    } finally {
        await redisClient.del(lockKey).catch(() => {});
    }
}

async function _createTicketFromNabilPaymentBody(paymentData, transactionId, stamp) {
    const otp = await commonUtil.createCode(8);
    const event = await Event.getEventById(paymentData.eventId);
    const paidAmount = paymentData.amount / 100;
    const paymentReference = transactionId || stamp;

    const ticketInfoDraft = {
        eventName: paymentData.eventName,
        ticketName: paymentData.ticketName,
        price: paidAmount,
        totalPrice: paidAmount,
        totalAmount: paidAmount,
        currency: paymentData.currency || 'NPR',
        purchaseDate: new Date().toISOString(),
        paymentReference,
        paymentProvider: 'nabil',
        nabilTransactionId: transactionId,
        nabilStamp: stamp,
        email: paymentData.email,
        merchantId: paymentData.merchantId,
        eventId: paymentData.eventId,
        ticketId: paymentData.ticketId,
        basePrice: paymentData.basePrice ? parseFloat(paymentData.basePrice) : undefined,
        serviceFee: paymentData.serviceFee ? parseFloat(paymentData.serviceFee) : undefined,
        vatRate: paymentData.vatRate ? parseFloat(paymentData.vatRate) : undefined,
        vatAmount: paymentData.vatAmount ? parseFloat(paymentData.vatAmount) : undefined,
        serviceTax: paymentData.serviceTax ? parseFloat(paymentData.serviceTax) : undefined,
        serviceTaxAmount: paymentData.serviceTaxAmount ? parseFloat(paymentData.serviceTaxAmount) : undefined,
        orderFee: paymentData.orderFee ? parseFloat(paymentData.orderFee) : undefined,
        orderFeeServiceTax: paymentData.orderFeeServiceTax ? parseFloat(paymentData.orderFeeServiceTax) : undefined,
        totalBasePrice: paymentData.totalBasePrice ? parseFloat(paymentData.totalBasePrice) : undefined,
        totalServiceFee: paymentData.totalServiceFee ? parseFloat(paymentData.totalServiceFee) : undefined,
        country: paymentData.country,
        fullName: paymentData.fullName,
        platformCommission: paymentData.commission
    };

    const ticketTypeConfig = findTicketTypeConfig(event, paymentData.ticketId);
    let inventoryAdmissionQuantity = null;
    if (ticketTypeConfig && event && paymentData.ticketId) {
        const inventoryCheck = validateTicketPurchaseInventory(event, ticketTypeConfig, {
            orderQuantity: paymentData.quantity,
            seatCount: 0,
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
        seatCount: 0
    });

    const emailCrypto = await hash.getCryptoBySearchIndex(paymentData.email, 'email');
    const emailHash = emailCrypto.length > 0
        ? emailCrypto[0]._id
        : (await hash.createHashData(paymentData.email, 'email'))._id;

    await PlatformMarketingConsent.getOrCreatePlatformConsent(emailHash);

    if (ticketTypeConfig && paymentData.ticketId && inventoryAdmissionQuantity != null) {
        const inventoryDecrement = await Event.decrementTicketTypeAvailable(
            event._id,
            paymentData.ticketId,
            inventoryAdmissionQuantity,
            ticketTypeConfig
        );
        if (!inventoryDecrement.success) {
            const err = new Error('INSUFFICIENT_TICKET_INVENTORY');
            err.code = 'INSUFFICIENT_TICKET_INVENTORY';
            throw err;
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

    await Ticket.updateTicketById(ticket._id, {
        paymentProvider: 'nabil',
        paymentReference,
        nabilTransactionId: transactionId,
        nabilStamp: stamp
    });

    if (!ticket.isSend) {
        const { normalizeLocale } = await import('../util/common.js');
        const locale = paymentData.locale ? normalizeLocale(paymentData.locale) : 'en-US';
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, paymentData.email, otp, locale);
        try {
            await queueTicketEmail(ticket._id.toString(), emailPayload);
        } catch (queueError) {
            error(`Failed to queue email for Nabil ticket: ${ticket._id}`, { error: queueError.message });
        }
    }

    try {
        await publishTicketCreationEvent(ticket, event, paymentData, paymentReference);
    } catch (publishError) {
        error(`Failed to publish Nabil ticket creation event: ${ticket._id}`, { error: publishError.message });
    }

    try {
        const merchant = await Merchant.getMerchantById(paymentData.merchantId);
        await publishPaymentCompleted({
            ticket,
            event,
            merchant,
            method: 'nabil',
            externalPaymentId: paymentReference || transactionId,
            grossCents: Number(paymentData.amount || 0),
            pspFeeCents: 0,
            checkoutChannel: resolveSiloCheckoutChannel(merchant, paymentData.checkoutHostname),
            currency: (paymentData.currency || 'npr').toLowerCase(),
        });
    } catch (accountingErr) {
        error(`Failed to publish accounting payment.completed for Nabil ticket: ${ticket._id}`, { error: accountingErr.message });
    }

    info(`Ticket created for Nabil payment: ${ticket._id} (transaction: ${transactionId}, stamp: ${stamp})`);
    return ticket;
}
