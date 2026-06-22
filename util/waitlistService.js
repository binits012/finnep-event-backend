import { v4 as uuidv4 } from 'uuid'
import * as consts from '../const.js'
import * as Event from '../model/event.js'
import { error, info } from '../model/logger.js'
import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import redisClient from '../model/redisConnect.js'
import * as commonUtil from '../util/common.js'
import { normalizeSiloSettings } from '../util/siloSettings.js'
import { isSiloSmtpConfigured, resolveSiloEmailBranding } from '../util/siloEmailSettings.js'
import * as VerificationCode from '../model/verificationCode.js'
import {
	loadSiloVerificationCodeTemplate,
	loadSiloWaitlistJoinedTemplate,
	getSiloEmailSubject
} from '../util/siloMail.js'
import { getEmailSubject } from '../util/emailTranslations.js'
import { queueGenericEmail, queueSiloEmail } from '../workers/emailWorker.js'

const WAITLIST_OTP_TTL = 300
const WAITLIST_SEND_COOLDOWN = 60

export function computeWaitlistOffer(eventDoc) {
	if (!eventDoc || eventDoc.otherInfo?.eventExtraInfo?.eventType === 'free') return null
	const wc = eventDoc.waitlistConfig && typeof eventDoc.waitlistConfig === 'object' ? eventDoc.waitlistConfig : {}
	if (wc.pre_sale_enabled) return 'pre_sale'
	const tickets = Array.isArray(eventDoc.ticketInfo) ? eventDoc.ticketInfo : []
	const hasSoldOut = tickets.some((t) => t && t.status === 'sold_out')
	if (wc.sold_out_enabled && hasSoldOut) return 'sold_out'
	return null
}

function normalizeWaitlistEmail(email) {
	if (!email || typeof email !== 'string' || !email.includes('@')) {
		throw Object.assign(new Error('Valid email required'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}
	return email.trim().toLowerCase()
}

function getEventDoc(event) {
	return event?._doc ?? event
}

function assertSiloReady(merchant) {
	const obj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	const silo = normalizeSiloSettings(obj?.siloSettings || {})
	if (!silo.enabled) {
		throw Object.assign(new Error('Silo storefront is not enabled'), { status: consts.HTTP_STATUS_BAD_REQUEST, code: 'SILO_NOT_ENABLED' })
	}
	if (!isSiloSmtpConfigured(silo.email)) {
		throw Object.assign(new Error('Silo email is not configured'), { status: consts.HTTP_STATUS_SERVICE_UNAVAILABLE, code: 'SILO_EMAIL_NOT_CONFIGURED' })
	}
	return { merchant: obj, silo }
}

async function assertEventOwnedByMerchant(event, merchantId) {
	if (!event) {
		throw Object.assign(new Error('Event not found'), { status: consts.HTTP_STATUS_RESOURCE_NOT_FOUND })
	}
	const eventMerchantId = event.merchant?._id?.toString?.() || event.merchant?.toString?.()
	if (eventMerchantId !== merchantId.toString()) {
		throw Object.assign(new Error('Event not found'), { status: consts.HTTP_STATUS_RESOURCE_NOT_FOUND })
	}
}

export async function sendWaitlistVerificationCode({
	eventId,
	email,
	channel = 'front',
	merchant = null,
	locale = 'en-US'
}) {
	const normalizedEmail = normalizeWaitlistEmail(email)
	const event = await Event.getEventById(eventId)
	const doc = getEventDoc(event)

	if (channel === 'silo') {
		await assertEventOwnedByMerchant(event, merchant._id)
		assertSiloReady(merchant)
	} else if (!event) {
		throw Object.assign(new Error('Event not found'), { status: consts.HTTP_STATUS_RESOURCE_NOT_FOUND })
	}

	const offer = computeWaitlistOffer(doc)
	if (!offer) {
		throw Object.assign(new Error('Waitlist is not available for this event'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	const cooldownKey = `waitlist_sent_at:${eventId}:${normalizedEmail}`
	const existing = await redisClient.get(cooldownKey)
	if (existing) {
		throw Object.assign(new Error('Please wait before requesting another code'), { status: consts.HTTP_STATUS_TOO_MANY_REQUESTS })
	}

	const code = Math.floor(10000000 + Math.random() * 90000000).toString()
	const hashedCode = VerificationCode.hashCode(code)
	const otpKey = `waitlist_otp:${eventId}:${normalizedEmail}`
	await Promise.all([
		redisClient.set(otpKey, hashedCode, { EX: WAITLIST_OTP_TTL }),
		redisClient.set(cooldownKey, '1', { EX: WAITLIST_SEND_COOLDOWN })
	])

	try {
		if (channel === 'silo') {
			const merchantObj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
			const merchantId = String(merchantObj?._id || merchantObj?.id || '')
			const branding = resolveSiloEmailBranding(merchant)
			const html = await loadSiloVerificationCodeTemplate(code, locale, branding)
			const subject = await getSiloEmailSubject('verification_code', locale, { companyName: branding.companyName })
			await queueSiloEmail(merchantId, { to: normalizedEmail, subject, html })
		} else {
			const html = await commonUtil.loadVerificationCodeTemplate(code, locale)
			const subject = await getEmailSubject('verification_code', locale, { companyName: process.env.COMPANY_TITLE || 'Finnep' })
			const sendMail = await import('../util/sendMail.js')
			await sendMail.forward({
				from: process.env.EMAIL_USERNAME,
				to: normalizedEmail,
				subject,
				html
			})
		}
	} catch (emailErr) {
		error('[waitlistService] email send failed', emailErr)
		if (emailErr.message === 'SILO_EMAIL_NOT_CONFIGURED') {
			throw Object.assign(new Error('Silo email is not configured'), { status: consts.HTTP_STATUS_SERVICE_UNAVAILABLE, code: 'SILO_EMAIL_NOT_CONFIGURED' })
		}
		throw Object.assign(new Error('Failed to send code'), { status: consts.HTTP_STATUS_INTERNAL_SERVER_ERROR })
	}

	return { message: 'Verification code sent to your email' }
}

export async function joinWaitlist({
	eventId,
	email,
	code,
	channel = 'front',
	merchant = null,
	locale = 'en-US'
}) {
	const normalizedEmail = normalizeWaitlistEmail(email)
	if (!code || typeof code !== 'string' || code.length < 5) {
		throw Object.assign(new Error('Verification code required'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	const event = await Event.getEventById(eventId)
	const doc = getEventDoc(event)

	if (channel === 'silo') {
		await assertEventOwnedByMerchant(event, merchant._id)
		assertSiloReady(merchant)
	} else if (!event) {
		throw Object.assign(new Error('Event not found'), { status: consts.HTTP_STATUS_RESOURCE_NOT_FOUND })
	}

	const type = computeWaitlistOffer(doc)
	if (!type) {
		throw Object.assign(new Error('Waitlist is not available for this event'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	const otpKey = `waitlist_otp:${eventId}:${normalizedEmail}`
	const storedHashed = await redisClient.get(otpKey)
	if (!storedHashed) {
		throw Object.assign(new Error('Invalid or expired code. Request a new code.'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	if (!VerificationCode.verifyCode(code.trim(), storedHashed)) {
		throw Object.assign(new Error('Invalid verification code'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	await Promise.all([
		redisClient.del(otpKey),
		redisClient.del(`waitlist_sent_at:${eventId}:${normalizedEmail}`)
	])

	let externalMerchantId = doc.externalMerchantId
	let externalEventId = doc.externalEventId != null ? String(doc.externalEventId) : undefined
	if (!externalMerchantId && event.merchant) {
		const m = event.merchant._doc ?? event.merchant
		externalMerchantId = m.merchantId ?? m.id
	}
	if (!externalMerchantId || externalEventId == null || externalEventId === '') {
		throw Object.assign(new Error('Event not linked to merchant'), { status: consts.HTTP_STATUS_BAD_REQUEST })
	}

	const exchangeName = process.env.RABBITMQ_EXCHANGE || 'event-merchant-exchange'
	const data = {
		merchant_id: String(externalMerchantId),
		event_id: String(externalEventId),
		email: normalizedEmail,
		type
	}
	const correlationId = uuidv4()
	const messageId = uuidv4()
	const aggregateId = (doc._id || event._id || event.id).toString()
	const messageBody = {
		eventType: 'WaitlistJoin',
		aggregateId,
		data,
		metadata: {
			correlationId,
			causationId: messageId,
			timestamp: new Date().toISOString(),
			version: 1,
			source: channel === 'silo' ? 'finnep-silo-storefront' : 'finnep-eventapp'
		}
	}
	const outboxMessageData = {
		messageId,
		exchange: exchangeName,
		routingKey: 'waitlist.join',
		messageBody,
		headers: {
			'content-type': 'application/json',
			'message-type': 'WaitlistJoin',
			'correlation-id': correlationId
		},
		correlationId,
		eventType: 'WaitlistJoin',
		aggregateId,
		status: 'pending',
		maxRetries: 3,
		attempts: 0
	}
	const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData)
	info('[waitlistService] outbox message created for waitlist.join', { messageId, eventId, channel })

	try {
		await messageConsumer.publishToExchange(
			exchangeName,
			outboxMessageData.routingKey,
			outboxMessageData.messageBody,
			{
				exchangeType: 'topic',
				publishOptions: {
					messageId,
					correlationId,
					contentType: 'application/json',
					headers: outboxMessageData.headers
				}
			}
		)
		await OutboxMessage.markMessageAsSent(outboxMessage._id)
	} catch (publishErr) {
		error('[waitlistService] failed to publish waitlist.join', { messageId, err: publishErr.message })
		await OutboxMessage.markMessageAsFailed(outboxMessage._id, publishErr.message).catch(() => {})
	}

	try {
		const eventTitle = doc.eventTitle || event?.eventTitle || 'Event'
		const eventPromotionalPhoto = doc.eventPromotionPhoto || doc.eventPromotionalPhoto || event?.eventPromotionPhoto

		if (channel === 'silo') {
			const merchantObj = merchant && typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
			const merchantId = String(merchantObj?._id || merchantObj?.id || '')
			const branding = resolveSiloEmailBranding(merchant)
			const html = await loadSiloWaitlistJoinedTemplate(eventTitle, locale, branding, {
				eventPromotionalPhoto: eventPromotionalPhoto || undefined
			})
			const subject = await getSiloEmailSubject('waitlist_joined', locale, {
				companyName: branding.companyName,
				eventTitle
			})
			await queueSiloEmail(merchantId, { to: normalizedEmail, subject, html })
		} else {
			const html = await commonUtil.loadWaitlistJoinedTemplate(eventTitle, locale, {
				eventPromotionalPhoto: eventPromotionalPhoto || undefined
			})
			const subject = await getEmailSubject('waitlist_joined', locale, {
				companyName: process.env.COMPANY_TITLE || 'Finnep',
				eventTitle
			})
			await queueGenericEmail({
				from: process.env.EMAIL_USERNAME,
				to: normalizedEmail,
				subject,
				html
			})
		}
	} catch (emailErr) {
		error('[waitlistService] failed to send confirmation email', { err: emailErr?.message })
	}

	return { message: 'Joined waitlist' }
}

export function mapWaitlistError(err) {
	const status = err.status || consts.HTTP_STATUS_INTERNAL_SERVER_ERROR
	return {
		status,
		body: {
			error: err.code || err.message || 'INTERNAL_SERVER_ERROR',
			message: err.message
		}
	}
}
