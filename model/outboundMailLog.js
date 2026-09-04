import mongoose from 'mongoose'
import './dbConnect.js'

const outboundMailLogSchema = new mongoose.Schema(
	{
		createdAt: { type: Date, default: Date.now },
		merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', index: true },
		externalMerchantId: { type: String, index: true },
		ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', index: true },
		mailType: {
			type: String,
			enum: ['ticket', 'otp', 'waitlist', 'presale', 'other'],
			default: 'other',
			index: true,
		},
		/** Masked recipient only — never store raw email here. */
		toMasked: { type: String, default: '' },
		transport: {
			type: String,
			enum: ['silo_smtp', 'platform_smtp', 'unknown'],
			default: 'unknown',
		},
		channel: { type: String, enum: ['silo', 'marketplace', 'unknown'], default: 'unknown' },
		status: {
			type: String,
			enum: ['accepted', 'failed', 'skipped'],
			required: true,
			index: true,
		},
		providerMessageId: { type: String, default: '' },
		errorCode: { type: String, default: '' },
		errorMessage: { type: String, default: '' },
		triggeredBy: {
			type: String,
			enum: ['checkout', 'resend', 'retry', 'worker', 'system'],
			default: 'system',
		},
		initiatedBy: { type: String, default: '' },
	},
	{ collection: 'outboundmaillogs' }
)

outboundMailLogSchema.index({ ticket: 1, createdAt: -1 })
outboundMailLogSchema.index({ externalMerchantId: 1, createdAt: -1 })
outboundMailLogSchema.index({ status: 1, createdAt: -1 })
outboundMailLogSchema.index({ mailType: 1, createdAt: -1 })

export const OutboundMailLog = mongoose.model('OutboundMailLog', outboundMailLogSchema)

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const toPositiveInt = (value, fallback) => {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback
	}
	return parsed
}

const toDateOrNull = (value) => {
	if (!value) return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

const isObjectIdLike = (value) => /^[a-fA-F0-9]{24}$/.test(String(value || ''))

const buildOutboundMailQuery = (filters = {}) => {
	const query = {}

	if (filters.status) {
		query.status = String(filters.status).trim()
	}
	if (filters.mailType) {
		query.mailType = String(filters.mailType).trim()
	}
	if (filters.transport) {
		query.transport = String(filters.transport).trim()
	}
	if (filters.channel) {
		query.channel = String(filters.channel).trim()
	}
	if (filters.triggeredBy) {
		query.triggeredBy = String(filters.triggeredBy).trim()
	}
	if (filters.externalMerchantId) {
		query.externalMerchantId = String(filters.externalMerchantId).trim()
	}
	if (filters.merchantId && isObjectIdLike(filters.merchantId)) {
		query.merchant = String(filters.merchantId).trim()
	}
	if (filters.ticketId && isObjectIdLike(filters.ticketId)) {
		query.ticket = String(filters.ticketId).trim()
	}

	if (filters.from || filters.to) {
		const fromDate = toDateOrNull(filters.from)
		const toDate = toDateOrNull(filters.to)
		if (fromDate || toDate) {
			query.createdAt = {}
			if (fromDate) query.createdAt.$gte = fromDate
			if (toDate) query.createdAt.$lte = toDate
		}
	}

	return query
}

export async function createOutboundMailLog(doc) {
	return OutboundMailLog.create(doc)
}

export async function getLatestOutboundMailLogForTicket(ticketId) {
	if (!ticketId) return null
	return OutboundMailLog.findOne({ ticket: ticketId }).sort({ createdAt: -1 }).lean()
}

/**
 * Admin list of outbound mail attempts. Recipients are already masked at write time.
 */
export async function listOutboundMailLogs(filters = {}) {
	const page = toPositiveInt(filters.page, 1)
	const limit = Math.min(toPositiveInt(filters.limit, DEFAULT_LIMIT), MAX_LIMIT)
	const skip = (page - 1) * limit
	const query = buildOutboundMailQuery(filters)

	const [items, total] = await Promise.all([
		OutboundMailLog.find(query)
			.populate('merchant', 'name merchantId country')
			.populate('ticket', 'otp isSend isRead event')
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.lean()
			.exec(),
		OutboundMailLog.countDocuments(query),
	])

	return {
		items,
		pagination: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit) || 1,
		},
	}
}
