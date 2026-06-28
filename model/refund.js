import { Refund } from './mongoModel.js';
import { error } from './logger.js';
import mongoose from 'mongoose';

export const getRefundByStripeRefundId = async (stripeRefundId) => {
    return await Refund.findOne({ stripeRefundId }).lean();
};

export const isRefundFullyApplied = (refund) => {
    if (!refund) return false;
    if (refund.applicationStatus === 'completed') return true;
    if (refund.processedAt && refund.applicationStatus !== 'failed') return true;
    return false;
};

/**
 * Create or return existing refund row for processing. Never marks completed.
 */
export const beginRefundProcessing = async (payload) => {
    const { stripeRefundId } = payload;

    const completed = await Refund.findOne({
        stripeRefundId,
        applicationStatus: 'completed',
    }).lean();
    if (completed) {
        return { record: completed, alreadyCompleted: true };
    }

    try {
        const record = await Refund.findOneAndUpdate(
            { stripeRefundId, applicationStatus: { $ne: 'completed' } },
            {
                $setOnInsert: {
                    createdAt: new Date(),
                    stripeRefundId,
                },
                $set: {
                    ...payload,
                    applicationStatus: 'processing',
                    processedAt: null,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true }
        ).lean();

        if (!record) {
            const again = await Refund.findOne({ stripeRefundId }).lean();
            return {
                record: again,
                alreadyCompleted: again?.applicationStatus === 'completed',
            };
        }

        if (record.applicationStatus === 'completed') {
            return { record, alreadyCompleted: true };
        }

        return { record, alreadyCompleted: false };
    } catch (err) {
        if (err?.code === 11000) {
            const dup = await Refund.findOne({ stripeRefundId }).lean();
            return {
                record: dup,
                alreadyCompleted: dup?.applicationStatus === 'completed',
            };
        }
        error('error beginning refund processing %s', err.stack);
        throw err;
    }
};

export const markRefundCompleted = async (stripeRefundId, extra = {}) => {
    return await Refund.findOneAndUpdate(
        { stripeRefundId },
        {
            $set: {
                applicationStatus: 'completed',
                processedAt: new Date(),
                ...extra,
            },
        },
        { new: true }
    ).lean();
};

export const markRefundFailed = async (stripeRefundId, reversalErrors = []) => {
    return await Refund.findOneAndUpdate(
        { stripeRefundId },
        {
            $set: {
                applicationStatus: 'failed',
                reversalErrors: Array.isArray(reversalErrors) ? reversalErrors : [String(reversalErrors)],
            },
        },
        { new: true }
    ).lean();
};

export const appendRefundReversalErrors = async (stripeRefundId, errors = []) => {
    if (!errors.length) return;
    await Refund.findOneAndUpdate(
        { stripeRefundId },
        { $push: { reversalErrors: { $each: errors } } }
    );
};

export const listRefundsByEventId = async (eventId, { skip = 0, limit = 50 } = {}) => {
    return await Refund.find({ event: eventId })
        .sort({ processedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

export const aggregateRefundsByEventId = async (eventId) => {
    const eventObjectId = typeof eventId === 'string'
        ? new mongoose.Types.ObjectId(eventId)
        : eventId;
    const result = await Refund.aggregate([
        {
            $match: {
                event: eventObjectId,
                status: 'succeeded',
                $or: [
                    { applicationStatus: 'completed' },
                    { processedAt: { $ne: null }, applicationStatus: { $ne: 'failed' } }
                ]
            },
        },
        {
            $group: {
                _id: null,
                totalRefunds: { $sum: '$amount' },
                count: { $sum: 1 },
            },
        },
    ]).exec();
    return result[0] || { totalRefunds: 0, count: 0 };
};
