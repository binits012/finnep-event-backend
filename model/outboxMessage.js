import { OutboxMessage } from './mongoModel.js'
import { error, info } from './logger.js'

export const createOutboxMessage = async (messageData) => {
    try {
        const outboxMessage = new OutboxMessage(messageData)
        const savedMessage = await outboxMessage.save()
        info('OutboxMessage created successfully:', savedMessage._id)
        return savedMessage
    } catch (err) {
        error('Error creating OutboxMessage:', err)
        throw err
    }
}

export const createOutboxMessagesBatch = async (messagesArray) => {
    try {
        if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
            throw new Error('messagesArray must be a non-empty array')
        }

        // Use insertMany for batch insert - much faster than individual saves
        const savedMessages = await OutboxMessage.insertMany(messagesArray, {
            ordered: false, // Continue on duplicate key errors
            lean: true      // Return plain JS objects for better performance
        })

        info(`Batch created ${savedMessages.length} OutboxMessages`)
        return savedMessages
    } catch (err) {
        // Handle bulk write errors gracefully
        if (err.name === 'MongoBulkWriteError' && err.writeErrors) {
            const successCount = err.insertedDocs?.length || 0
            const errorCount = err.writeErrors.length

            info(`Batch insert completed with ${successCount} successes and ${errorCount} failures`)

            // Return successfully inserted documents
            return err.insertedDocs || []
        }

        error('Error batch creating OutboxMessages:', err)
        throw err
    }
}

export const getOutboxMessageById = async (id) => {
    try {
        const outboxMessage = await OutboxMessage.findById(id)
        return outboxMessage
    } catch (err) {
        error('Error fetching OutboxMessage by ID:', err)
        throw err
    }
}

export const getOutboxMessageByMessageId = async (messageId) => {
    try {
        const outboxMessage = await OutboxMessage.findOne({ messageId })
        return outboxMessage
    } catch (err) {
        error('Error fetching OutboxMessage by messageId:', err)
        throw err
    }
}

export const getAllOutboxMessages = async (filter = {}, limit = null, skip = 0) => {
    try {
        let query = OutboxMessage.find(filter).sort({ createdAt: -1 })

        if (skip > 0) {
            query = query.skip(skip)
        }

        if (limit) {
            query = query.limit(limit)
        }

        const outboxMessages = await query.exec()
        return outboxMessages
    } catch (err) {
        error('Error fetching all OutboxMessages:', err)
        throw err
    }
}

export const updateOutboxMessageById = async (id, updateData) => {
    try {
        updateData.updatedAt = new Date()
        const updatedMessage = await OutboxMessage.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        )
        if (updatedMessage) {
            info('OutboxMessage updated successfully:', id)
        }
        return updatedMessage
    } catch (err) {
        error('Error updating OutboxMessage:', err)
        throw err
    }
}

export const updateOutboxMessageByMessageId = async (messageId, updateData) => {
    try {
        updateData.updatedAt = new Date()
        const updatedMessage = await OutboxMessage.findOneAndUpdate(
            { messageId },
            updateData,
            { new: true, runValidators: true }
        )
        if (updatedMessage) {
            info('OutboxMessage updated successfully by messageId:', messageId)
        }
        return updatedMessage
    } catch (err) {
        error('Error updating OutboxMessage by messageId:', err)
        throw err
    }
}

export const deleteOutboxMessageById = async (id) => {
    try {
        const deletedMessage = await OutboxMessage.findByIdAndDelete(id)
        if (deletedMessage) {
            info('OutboxMessage deleted successfully:', id)
        }
        return deletedMessage
    } catch (err) {
        error('Error deleting OutboxMessage:', err)
        throw err
    }
}

export const getOutboxMessagesByStatus = async (status, limit = null) => {
    try {
        let query = OutboxMessage.find({ status }).sort({ createdAt: 1 })

        if (limit) {
            query = query.limit(limit)
        }

        const outboxMessages = await query.exec()
        return outboxMessages
    } catch (err) {
        error('Error fetching OutboxMessages by status:', err)
        throw err
    }
}

export const getOutboxMessagesForRetry = async (limit = 10) => {
    try {
        const now = new Date()
        const retryMessages = await OutboxMessage.find({
            status: { $in: ['failed', 'retrying','pending'] },
            attempts: { $lt: 3 }, // Less than maxRetries
            $or: [
                { nextRetryAt: { $exists: false } },
                { nextRetryAt: { $lte: now } }
            ]
        })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec()

        return retryMessages
    } catch (err) {
        error('Error fetching OutboxMessages for retry:', err)
        throw err
    }
}

export const getOutboxMessagesByEventType = async (eventType, limit = null, skip = 0) => {
    try {
        let query = OutboxMessage.find({ eventType }).sort({ createdAt: -1 })

        if (skip > 0) {
            query = query.skip(skip)
        }

        if (limit) {
            query = query.limit(limit)
        }

        const outboxMessages = await query.exec()
        return outboxMessages
    } catch (err) {
        error('Error fetching OutboxMessages by eventType:', err)
        throw err
    }
}

export const markMessageAsSent = async (id) => {
    try {
        const updateData = {
            status: 'sent',
            sentAt: new Date(),
            processedAt: new Date(),
            updatedAt: new Date()
        }

        const updatedMessage = await OutboxMessage.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        )

        if (updatedMessage) {
            info('OutboxMessage marked as sent:', id)
        }
        return updatedMessage
    } catch (err) {
        error('Error marking OutboxMessage as sent:', err)
        throw err
    }
}

export const markMessageAsFailed = async (id, errorMessage) => {
    try {
        const updateData = {
            status: 'failed',
            lastError: errorMessage,
            updatedAt: new Date(),
            $inc: { attempts: 1 }
        }

        // Calculate next retry time (exponential backoff)
        const baseDelay = 60000 // 1 minute
        const maxDelay = 3600000 // 1 hour
        const message = await OutboxMessage.findById(id)
        if (message) {
            const delay = Math.min(baseDelay * Math.pow(2, message.attempts), maxDelay)
            updateData.nextRetryAt = new Date(Date.now() + delay)

            // If max retries reached, don't set nextRetryAt
            if (message.attempts >= (message.maxRetries - 1)) {
                delete updateData.nextRetryAt
            } else {
                updateData.status = 'retrying'
            }
        }

        const updatedMessage = await OutboxMessage.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        )

        if (updatedMessage) {
            info('OutboxMessage marked as failed:', id)
        }
        return updatedMessage
    } catch (err) {
        error('Error marking OutboxMessage as failed:', err)
        throw err
    }
}

export const getOutboxMessageStats = async () => {
    try {
        const stats = await OutboxMessage.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ])

        const result = {
            pending: 0,
            sent: 0,
            failed: 0,
            retrying: 0
        }

        stats.forEach(stat => {
            result[stat._id] = stat.count
        })

        return result
    } catch (err) {
        error('Error getting OutboxMessage stats:', err)
        throw err
    }
}
