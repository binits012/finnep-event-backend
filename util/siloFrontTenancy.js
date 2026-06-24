import * as consts from '../const.js'
import { RESOURCE_NOT_FOUND } from '../applicationTexts.js'

export function isSiloFrontRequest(req) {
	return Boolean(
		String(req.headers['x-silo-merchant-object-id'] || '').trim()
		|| String(req.headers['x-silo-merchant-id'] || '').trim()
	)
}

export function getSiloMerchantObjectId(req) {
	return String(req.headers['x-silo-merchant-object-id'] || '').trim()
}

export function resolveEventMerchantObjectId(event) {
	if (!event) return ''
	const merchant = event.merchant ?? event._doc?.merchant
	if (!merchant) return ''
	if (typeof merchant === 'object' && merchant._id != null) {
		return String(merchant._id)
	}
	return String(merchant)
}

export function eventBelongsToSiloMerchant(event, siloMerchantObjectId) {
	if (!siloMerchantObjectId) return true
	return resolveEventMerchantObjectId(event) === siloMerchantObjectId
}

/** Returns false when a 404 response was sent. */
export function assertSiloEventAccess(req, res, event) {
	if (!isSiloFrontRequest(req)) return true
	const siloMerchantObjectId = getSiloMerchantObjectId(req)
	if (!siloMerchantObjectId) return true
	if (eventBelongsToSiloMerchant(event, siloMerchantObjectId)) return true
	res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
	return false
}
