import { EventManifest } from '../../model/mongoModel.js';
import { deleteSeatCheckoutSession } from '../../util/seatCheckoutSession.js';
import { error, info } from '../../model/logger.js';
import { manifestUpdateService } from './manifestUpdateService.js';
import { resolveSoldPlaceIdsForPayment } from './paymentSeatResolutionService.js';
import { seatReservationService } from './seatReservationService.js';

/**
 * Reject checkout when requested seats are already sold (call before creating payment).
 */
export async function assertSeatsAvailableForPurchase({
	eventId,
	event,
	sessionId,
	placeIds = [],
	sectionSelections = [],
	logPrefix = '[assertSeatsAvailableForPurchase]',
}) {
	if (!event?.venue?.venueId) {
		return { placeIdsToCheck: [] };
	}

	const { placeIds: resolvedPlaceIds } = await resolveSoldPlaceIdsForPayment({
		eventId,
		sessionId,
		placeIds,
		sectionSelections,
	});

	if (resolvedPlaceIds.length === 0) {
		return { placeIdsToCheck: [] };
	}

	const eventManifest = await EventManifest.findOne({ eventId: String(event._id) }).lean();
	const soldSet = new Set(eventManifest?.availability?.sold || []);
	const alreadySold = resolvedPlaceIds.filter((placeId) => soldSet.has(placeId));
	if (alreadySold.length > 0) {
		const err = new Error('One or more seats are already sold');
		err.code = 'SEATS_ALREADY_SOLD';
		err.alreadySold = alreadySold;
		throw err;
	}

	info(`${logPrefix} ${resolvedPlaceIds.length} seat(s) available for purchase on event ${eventId}`);
	return { placeIdsToCheck: resolvedPlaceIds };
}

/**
 * Resolve seats, atomically mark sold, and release Redis holds.
 * Must run before ticket creation to prevent double sale of the same seat.
 */
export async function fulfillSeatPurchaseBeforeTicket({
	eventId,
	event,
	sessionId,
	placeIds = [],
	sectionSelections = [],
	checkoutToken = null,
	logPrefix = '[fulfillSeatPurchase]',
}) {
	if (!event?.venue?.venueId) {
		return { placeIdsToMarkSold: [], areaSoldIncrements: [], unresolvedSelections: [] };
	}

	const { placeIds: placeIdsToMarkSold, areaSoldIncrements, unresolvedSelections } =
		await resolveSoldPlaceIdsForPayment({
			eventId,
			sessionId,
			placeIds,
			sectionSelections,
		});

	if (unresolvedSelections.length > 0) {
		error(`${logPrefix} Could not fully resolve sectionSelections:`, unresolvedSelections);
	}

	const eventMongoId = String(event._id);
	const eventManifest = await EventManifest.findOne({ eventId: eventMongoId });
	if (!eventManifest) {
		error(`${logPrefix} EventManifest not found for event ${eventId}`);
		return { placeIdsToMarkSold, areaSoldIncrements, unresolvedSelections };
	}

	if (areaSoldIncrements.length > 0) {
		await manifestUpdateService.markAreaSelectionsSold(
			eventManifest._id.toString(),
			areaSoldIncrements
		);
	}

	if (placeIdsToMarkSold.length > 0) {
		await manifestUpdateService.assertAndMarkSeatsAsSold(
			eventManifest._id.toString(),
			placeIdsToMarkSold
		);
		await seatReservationService.releaseReservations(eventId, placeIdsToMarkSold);
		info(`${logPrefix} Marked ${placeIdsToMarkSold.length} seat(s) sold for event ${eventId}`);
	}

	if (checkoutToken) {
		try {
			await deleteSeatCheckoutSession(checkoutToken);
		} catch (checkoutErr) {
			error(`${logPrefix} Failed to delete checkout session:`, checkoutErr);
		}
	}

	return { placeIdsToMarkSold, areaSoldIncrements, unresolvedSelections };
}

export default fulfillSeatPurchaseBeforeTicket;
