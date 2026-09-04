import * as consts from '../const.js'
import { listOutboundMailLogs } from '../model/outboundMailLog.js'
import { error } from '../model/logger.js'
// Ensure Merchant / Ticket models are registered for populate
import '../model/mongoModel.js'

const normalizeId = (value) => {
	if (!value) return null
	if (typeof value === 'string' || typeof value === 'number') return String(value)
	if (typeof value?.toString === 'function') {
		const asString = value.toString()
		if (asString && asString !== '[object Object]') return asString
	}
	if (value?.$oid) return String(value.$oid)
	return null
}

const mapOutboundMailLog = (item) => {
	const merchant = item.merchant && typeof item.merchant === 'object' ? item.merchant : null
	const ticket = item.ticket && typeof item.ticket === 'object' ? item.ticket : null

	return {
		id: normalizeId(item._id),
		createdAt: item.createdAt,
		mailType: item.mailType || 'other',
		status: item.status,
		transport: item.transport || 'unknown',
		channel: item.channel || 'unknown',
		toMasked: item.toMasked || '',
		triggeredBy: item.triggeredBy || 'system',
		initiatedBy: item.initiatedBy || '',
		providerMessageId: item.providerMessageId || '',
		errorCode: item.errorCode || '',
		errorMessage: item.errorMessage ? String(item.errorMessage).slice(0, 500) : '',
		externalMerchantId: item.externalMerchantId || '',
		merchant: merchant
			? {
					id: normalizeId(merchant._id),
					name: merchant.name || null,
					merchantId: merchant.merchantId || null,
					country: merchant.country || null,
				}
			: item.merchant
				? { id: normalizeId(item.merchant), name: null, merchantId: null, country: null }
				: null,
		ticket: ticket
			? {
					id: normalizeId(ticket._id),
					otp: ticket.otp || null,
					isSend: Boolean(ticket.isSend),
					isRead: Boolean(ticket.isRead),
					eventId: normalizeId(ticket.event),
				}
			: item.ticket
				? { id: normalizeId(item.ticket), otp: null, isSend: false, isRead: false, eventId: null }
				: null,
	}
}

export const getOutboundMailLogs = async (req, res) => {
	try {
		const filters = {
			status: req.query.status,
			mailType: req.query.mailType,
			transport: req.query.transport,
			channel: req.query.channel,
			triggeredBy: req.query.triggeredBy,
			externalMerchantId: req.query.externalMerchantId,
			merchantId: req.query.merchantId,
			ticketId: req.query.ticketId,
			from: req.query.from,
			to: req.query.to,
			page: req.query.page,
			limit: req.query.limit,
		}

		const { items, pagination } = await listOutboundMailLogs(filters)

		return res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			data: items.map(mapOutboundMailLog),
			pagination,
		})
	} catch (err) {
		error('Error fetching outbound mail logs: %s', err.stack || err.message)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			success: false,
			message: 'Failed to fetch outbound mail logs',
		})
	}
}
