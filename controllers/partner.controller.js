import * as consts from '../const.js'
import * as Event from '../model/event.js'
import * as Merchant from '../model/merchant.js'
import { error } from '../model/logger.js'
import { INTERNAL_SERVER_ERROR, RESOURCE_NOT_FOUND } from '../applicationTexts.js'
import { toPartnerThemePayload } from '../util/siloSettings.js'
import { mapLikeToPlain, normalizeMerchantSocialMedia } from '../util/merchantSocialMedia.js'
import { resolvePartnerLegalContent } from '../util/legalContent.js'
import { sanitizePublicEventForFront, toPublicEventMerchantRef } from '../util/publicMerchant.js'
import { parseRequestMarketCountryCode } from '../util/platformSettings.js'
import {
	sendWaitlistVerificationCode,
	joinWaitlist,
	mapWaitlistError
} from '../util/waitlistService.js'
import { getPresalePayload } from '../util/presaleToken.js'
import redisClient from '../model/redisConnect.js'
import { extractLocaleFromRequest } from '../util/common.js'

function toPublicMerchantProfile(merchant) {
	if (!merchant) return null
	const obj = typeof merchant.toObject === 'function' ? merchant.toObject() : merchant
	return {
		name: obj.name,
		orgName: obj.orgName,
		country: obj.country,
		website: obj.website,
		logo: obj.logo,
		status: obj.status,
		email: obj.companyEmail || obj.email || undefined,
		phone: obj.companyPhoneNumber || obj.phone || undefined,
		address: obj.companyAddress || obj.address || undefined,
		socialMedia: normalizeMerchantSocialMedia(mapLikeToPlain(obj.socialMedia))
	}
}

function sanitizePartnerMerchantRef(merchant) {
	return toPublicEventMerchantRef(merchant)
}

function sanitizePartnerEvent(event) {
	const discountCodes = event?.discountCodes
	return sanitizePublicEventForFront(event, {
		hasDiscountCodes: Array.isArray(discountCodes) && discountCodes.some((d) => d?.active !== false)
	})
}

export const getPartnerMerchant = async (req, res) => {
	try {
		const merchant = await Merchant.getMerchantById(req.partnerMerchant._id)
		if (!merchant) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		return res.status(consts.HTTP_STATUS_OK).json({
			merchant: toPublicMerchantProfile(merchant)
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const getPartnerTheme = async (req, res) => {
	try {
		const merchant = await Merchant.getMerchantById(req.partnerMerchant._id)
		if (!merchant) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		return res.status(consts.HTTP_STATUS_OK).json({
			theme: toPartnerThemePayload(merchant)
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const getPartnerLegal = async (req, res) => {
	try {
		const merchant = await Merchant.getMerchantById(req.partnerMerchant._id)
		if (!merchant) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		const countryCode = parseRequestMarketCountryCode(req)
		const legal = await resolvePartnerLegalContent(merchant, countryCode)
		return res.status(consts.HTTP_STATUS_OK).json({ legal })
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const listPartnerEvents = async (req, res) => {
	try {
		const q = req.query || {}
		const pageNum = Math.max(parseInt(String(q.page || '1'), 10) || 1, 1)
		const limitNum = Math.min(Math.max(parseInt(String(q.limit || '50'), 10) || 50, 1), 200)

		const { items, total } = await Event.listPartnerMerchantEvents({
			merchantId: req.partnerMerchant._id,
			city: q.city,
			country: q.country,
			page: pageNum,
			limit: limitNum
		})

		const partnerItems = (items || []).map(sanitizePartnerEvent)

		const totalPages = Math.max(Math.ceil(total / limitNum), 1)
		return res.status(consts.HTTP_STATUS_OK).json({
			items: partnerItems,
			page: pageNum,
			limit: limitNum,
			total,
			totalPages
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const getPartnerEventById = async (req, res) => {
	try {
		const event = await Event.getEventById(req.params.id)
		if (!event) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}

		const eventMerchantId = event.merchant?._id?.toString?.() || event.merchant?.toString?.()
		if (eventMerchantId !== req.partnerMerchant._id.toString()) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}

		if (event.active === false && !Event.isEventPastByEndDate(event)) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}

		const sanitized = sanitizePartnerEvent(event)
		const presaleToken = req.query.presale
		if (presaleToken && typeof presaleToken === 'string') {
			const payload = await getPresalePayload(redisClient, presaleToken)
			if (payload && String(payload.eventId) === String(req.params.id)) {
				sanitized.presaleAccess = true
			}
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			event: sanitized
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

async function loadPartnerMerchantRecord(req) {
	return Merchant.getMerchantById(req.partnerMerchant._id)
}

export const sendPartnerWaitlistCode = async (req, res) => {
	try {
		const merchant = await loadPartnerMerchantRecord(req)
		if (!merchant) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		const { email } = req.body || {}
		const locale = extractLocaleFromRequest(req)
		const result = await sendWaitlistVerificationCode({
			eventId: req.params.id,
			email,
			channel: 'silo',
			merchant,
			locale
		})
		return res.status(consts.HTTP_STATUS_OK).json(result)
	} catch (err) {
		error(err)
		const mapped = mapWaitlistError(err)
		return res.status(mapped.status).json(mapped.body)
	}
}

export const joinPartnerWaitlist = async (req, res) => {
	try {
		const merchant = await loadPartnerMerchantRecord(req)
		if (!merchant) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		const { email, code } = req.body || {}
		const locale = extractLocaleFromRequest(req)
		const result = await joinWaitlist({
			eventId: req.params.id,
			email,
			code,
			channel: 'silo',
			merchant,
			locale
		})
		return res.status(consts.HTTP_STATUS_OK).json(result)
	} catch (err) {
		error(err)
		const mapped = mapWaitlistError(err)
		return res.status(mapped.status).json(mapped.body)
	}
}
