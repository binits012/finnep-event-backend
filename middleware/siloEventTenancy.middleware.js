import * as Event from '../model/event.js'
import * as consts from '../const.js'
import { RESOURCE_NOT_FOUND } from '../applicationTexts.js'
import {
	eventBelongsToSiloMerchant,
	getSiloMerchantObjectId,
	isSiloFrontRequest,
} from '../util/siloFrontTenancy.js'

export async function enforceSiloEventRouteTenancy(req, res, next, eventId) {
	if (!isSiloFrontRequest(req)) return next()
	const siloMerchantObjectId = getSiloMerchantObjectId(req)
	if (!siloMerchantObjectId) return next()

	const event = await Event.getEventById(eventId)
	if (!event || !eventBelongsToSiloMerchant(event, siloMerchantObjectId)) {
		return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
	}
	return next()
}

/** Express router.param handler for :eventId routes (does not affect /guest/ticket/:id). */
export function siloEventTenancyParamHandler(req, res, next, eventId) {
	enforceSiloEventRouteTenancy(req, res, next, eventId).catch(next)
}

/** Per-route middleware when the event id param name is not eventId (e.g. /event/:id). */
export function createSiloEventTenancyMiddleware(paramName = 'eventId') {
	return (req, res, next) => {
		const eventId = req.params[paramName]
		if (!eventId) return next()
		return enforceSiloEventRouteTenancy(req, res, next, eventId).catch(next)
	}
}
