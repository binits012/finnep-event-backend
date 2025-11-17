import * as model from '../model/mongoModel.js'
import { error, info } from '../model/logger.js'
import * as Event from './event.js'
import { getMerchantByMerchantId } from './merchant.js'

export const saveExternalTicketSale = async (saleData) => {
    try {
        // Check if messageId already exists (idempotency check)
        if (saleData.messageId) {
            const existing = await model.ExternalTicketSales.findOne({ messageId: saleData.messageId }).lean();
            if (existing) {
                info(`External ticket sale with messageId ${saleData.messageId} already exists, skipping duplicate`);
                return null; // Return null to indicate it was a duplicate
            }
        }

        // Map external IDs to internal MongoDB ObjectIds
        const merchant = await getMerchantByMerchantId(saleData.externalMerchantId);
        if (!merchant) {
            throw new Error(`Merchant with external ID ${saleData.externalMerchantId} not found`);
        }

        const event = await Event.getEventByMerchantAndExternalId(saleData.externalMerchantId, saleData.externalEventId);
        if (!event) {
            throw new Error(`Event with external ID ${saleData.externalEventId} not found`);
        }

        const externalSale = new model.ExternalTicketSales({
            eventId: event._id,
            externalEventId: saleData.externalEventId,
            merchantId: merchant._id,
            externalMerchantId: saleData.externalMerchantId,
            ticketType: saleData.ticketType,
            quantity: saleData.quantity,
            unitPrice: saleData.unitPrice,
            saleDate: saleData.saleDate,
            source: saleData.source,
            paymentMethod: saleData.paymentMethod,
            currency: saleData.currency || 'EUR',
            messageId: saleData.messageId
        });

        try {
            return await externalSale.save();
        } catch (saveErr) {
            // Handle duplicate key error (race condition - another process saved it first)
            if (saveErr.code === 11000 && saleData.messageId) {
                info(`Duplicate key error for messageId ${saleData.messageId}, checking if already processed`);
                const alreadyExists = await model.ExternalTicketSales.findOne({ messageId: saleData.messageId }).lean();
                if (alreadyExists) {
                    info(`External ticket sale with messageId ${saleData.messageId} already exists (race condition), skipping`);
                    return null;
                }
            }
            throw saveErr;
        }
    } catch (err) {
        error('Error saving external ticket sale: %s', err.stack);
        throw err;
    }
}

export const getExternalTicketSalesByEvent = async (eventId) => {
    try {
        return await model.ExternalTicketSales.find({ eventId })
            .sort({ saleDate: 1 })
            .lean()
            .exec();
    } catch (err) {
        error('Error getting external ticket sales by event: %s', err.stack);
        throw err;
    }
}

export const aggregateExternalSalesByEvent = async (eventId) => {
    try {
        const aggregation = await model.ExternalTicketSales.aggregate([
            { $match: { eventId: eventId } },
            {
                $group: {
                    _id: {
                        ticketType: '$ticketType',
                        source: '$source'
                    },
                    quantity: { $sum: '$quantity' },
                    revenue: { $sum: { $multiply: ['$unitPrice', '$quantity'] } },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.ticketType',
                    sources: {
                        $push: {
                            source: '$_id.source',
                            quantity: '$quantity',
                            revenue: '$revenue',
                            count: '$count'
                        }
                    },
                    totalQuantity: { $sum: '$quantity' },
                    totalRevenue: { $sum: '$revenue' }
                }
            }
        ]);

        return aggregation;
    } catch (err) {
        error('Error aggregating external sales by event: %s', err.stack);
        throw err;
    }
}

export const checkMessageProcessed = async (messageId) => {
    try {
        const existing = await model.ExternalTicketSales.findOne({ messageId }).lean();
        return !!existing;
    } catch (err) {
        error('Error checking if message is processed: %s', err.stack);
        throw err;
    }
}

