/**
 * Strip merchant documents down to fields safe for unauthenticated storefront clients.
 */

export function toPublicEventMerchantRef(merchant) {
	if (!merchant) return null
	const obj = typeof merchant.toObject === 'function' ? merchant.toObject() : { ...merchant }
	if (!obj._id && !obj.name) return null

	return {
		_id: obj._id,
		merchantId: obj.merchantId,
		name: obj.name,
		orgName: obj.orgName,
		website: obj.website || undefined,
		logo: obj.logo || undefined,
		stripeAccount: obj.stripeAccount || undefined,
		paytrailEnabled: Boolean(obj.paytrailEnabled),
		nabilEnabled: Boolean(obj.nabilEnabled),
	}
}

function eventToPlainObject(event) {
	if (!event) return null
	if (typeof event.toObject === 'function') {
		return event.toObject({ virtuals: false })
	}
	if (event._doc) return { ...event._doc }
	return { ...event }
}

/** Public event payload for /front/event, homepage lists, and partner APIs. */
export function sanitizePublicEventForFront(event, extra = {}) {
	const obj = eventToPlainObject(event)
	if (!obj) return null

	delete obj.discountCodes

	if (obj.merchant) {
		obj.merchant = toPublicEventMerchantRef(obj.merchant)
	}

	if (obj.socialMedia instanceof Map) {
		obj.socialMedia = Object.fromEntries(obj.socialMedia.entries())
	}

	return { ...obj, ...extra }
}
