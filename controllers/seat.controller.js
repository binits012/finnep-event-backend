import * as jwtToken from '../util/jwtToken.js';
import * as consts from '../const.js';
import * as appText from '../applicationTexts.js';
import { Event } from '../model/mongoModel.js';
import { manifestUpdateService } from '../src/services/manifestUpdateService.js';
import { seatReservationService } from '../src/services/seatReservationService.js';
import { error, info } from '../model/logger.js';

const resolveSectionMode = (section) => {
	if (!section) return 'seat';
	// Seating sections must remain seat-based even if stale data has selectionMode='area'
	// from older manifests.
	if (section.sectionType === 'Seating') return 'seat';
	if (section.selectionMode) return section.selectionMode;
	return section.sectionType === 'Seating' ? 'seat' : 'area';
};

const normalizeAreaSections = (fullManifest, soldSet, reservedSet, areaSoldCounts = {}) => {
	const readAreaSoldCount = (key) => {
		if (!key) return 0;
		// Handle both plain objects and Mongoose Map/JS Map.
		if (typeof areaSoldCounts?.get === 'function') {
			const v = areaSoldCounts.get(String(key));
			return Number(v || 0) || 0;
		}
		const v = areaSoldCounts?.[String(key)];
		return Number(v || 0) || 0;
	};

	const sections = Array.isArray(fullManifest?.sections) ? fullManifest.sections : [];
	const places = Array.isArray(fullManifest?.places) ? fullManifest.places : [];
	const seatSections = [];
	const areaSections = [];

	for (const section of sections) {
		const sectionId = section.id || section._id || section.name;
		const selectionMode = resolveSectionMode(section);
		if (selectionMode === 'seat') {
			seatSections.push(section);
			continue;
		}
		const sectionPlaces = places.filter((p) => p.section === section.name || p.section === sectionId);
		const areaSoldByCounter = readAreaSoldCount(sectionId) || readAreaSoldCount(section.name);
		const soldCountByPlaceId = sectionPlaces.filter((p) => soldSet.has(p.placeId)).length;
		const soldCount = Math.max(areaSoldByCounter, soldCountByPlaceId);
		const reservedCount = sectionPlaces.filter((p) => reservedSet.has(p.placeId)).length;
		const inferredCapacity = sectionPlaces.length;
		const capacity = Number(section.capacity || inferredCapacity || 0);
		areaSections.push({
			id: sectionId,
			name: section.name,
			sectionType: section.sectionType || 'Custom',
			selectionMode: 'area',
			capacity,
			soldCount,
			reservedCount,
			availableCount: Math.max(0, capacity - soldCount - reservedCount),
			color: section.color || '#2196F3'
		});
	}

	return { seatSections, areaSections };
};

/**
 * Get seat map with availability for an event
 * Merges encoded manifest (MongoDB EventManifest) + enriched manifest (S3) + Redis reservations
 */
export const getEventSeats = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const eventId = req.params.eventId;

		await jwtToken.verifyJWT(token, async (err, data) => {
			if (err) {
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Please, provide valid token',
					error: appText.TOKEN_NOT_VALID
				});
			}

			try {
				// 1. Get event to check if it has seat selection enabled
				const event = await Event.findById(eventId);
				if (!event) {
					return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
						message: 'Event not found',
						error: appText.RESOURCE_NOT_FOUND
					});
				}

				// Check if event has seat selection
				if (!event.venue || !event.venue?.venueId) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
						message: 'Event does not have seat selection enabled',
						error: 'SEAT_SELECTION_NOT_ENABLED'
					});
				}

				// 2. Load encoded manifest from MongoDB (EventManifest collection)
				const encodedManifest = await manifestUpdateService.getEventManifest(eventId);
				if (!encodedManifest) {
					return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
						message: 'Manifest not found for this event',
						error: appText.RESOURCE_NOT_FOUND
					});
				}

				// 3. Get enriched manifest from S3 (contains venue structure + pricing)
				// This is the source of truth after pricing configuration
				if (!encodedManifest.s3Key) {
					return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
						message: 'S3 key not found in event manifest',
						error: appText.RESOURCE_NOT_FOUND
					});
				}

				const { downloadPricingFromS3 } = await import('../../util/aws.js');
				const fullManifest = await downloadPricingFromS3(encodedManifest.s3Key);
				if (!fullManifest || !fullManifest.places) {
					return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
						message: 'Full manifest not found in S3',
						error: appText.RESOURCE_NOT_FOUND
					});
				}

				// 4. Get Redis reservations for event
				const reservedMap = await seatReservationService.getReservedSeats(eventId);

				// 5. Merge data for display
				const soldSet = new Set(encodedManifest.availability?.sold || []);
				const reservedSet = new Set(reservedMap.keys());

				// Create a map of placeId -> full place data for quick lookup
				const fullPlaceMap = new Map();
				if (fullManifest.places && Array.isArray(fullManifest.places)) {
					for (const place of fullManifest.places) {
						fullPlaceMap.set(place.placeId, place);
					}
				}

				// Build seats array with merged data
				const seats = [];
				for (const placeId of encodedManifest.placeIds || []) {
					const fullPlace = fullPlaceMap.get(placeId);

					// Determine status
					let status = 'available';
					if (soldSet.has(placeId)) {
						status = 'sold';
					} else if (reservedSet.has(placeId)) {
						status = 'reserved';
					}

					// Get price from partition lookup
					const price = await manifestUpdateService.getPriceForPlaceIdByEvent(eventId, placeId);

					// Build seat object
					const seat = {
						placeId: placeId,
						x: fullPlace?.x || null,
						y: fullPlace?.y || null,
						row: fullPlace?.row || null,
						seat: fullPlace?.seat || null,
						section: fullPlace?.section || null,
						price: price,
						status: status
					};

					seats.push(seat);
				}

				// 6. Extract sections from full manifest (venue configuration)
				// Format sections for client display (similar to CMS)
				const sections = [];
				if (fullManifest.sections && Array.isArray(fullManifest.sections)) {
					for (const section of fullManifest.sections) {
						sections.push({
							id: section.id || section._id || section.name,
							name: section.name,
							color: section.color || '#2196F3',
							bounds: section.bounds || null,
							polygon: section.polygon || null
						});
					}
				}

				const areaSoldCounts = encodedManifest?.availability?.areaSoldCounts || {};
				const { seatSections, areaSections } = normalizeAreaSections(fullManifest, soldSet, reservedSet, areaSoldCounts);

				// 7. Return merged data
				// backgroundSvg and sections come from full manifest (venue configuration), not encoded manifest
				return res.status(consts.HTTP_STATUS_OK).json({
					data: {
						backgroundSvg: fullManifest.backgroundSvg || null, // From venue manifest
						sections: sections, // From venue manifest
						seatSections,
						areaSections,
						seats: seats, // Merged from encoded manifest (placeIds) + full manifest (coordinates) + availability
						total: seats.length,
						available: seats.filter(s => s.status === 'available').length,
						reserved: seats.filter(s => s.status === 'reserved').length,
						sold: seats.filter(s => s.status === 'sold').length
					}
				});
			} catch (err) {
				error('Error getting event seats:', err);
				next(err);
			}
		});
	} catch (err) {
		error('Error in getEventSeats:', err);
		next(err);
	}
};

/**
 * Reserve seats for an event (Redis, 7 min TTL)
 */
export const reserveSeats = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const eventId = req.params.eventId;
		const { placeIds, sectionSelections, sessionId, email } = req.body;

		if (!sessionId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'sessionId is required',
				error: appText.INVALID_DATA
			});
		}

		// Email is optional for backward compatibility during seat selection
		// but recommended for final reservations after OTP verification

		await jwtToken.verifyJWT(token, async (err, data) => {
			if (err) {
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Please, provide valid token',
					error: appText.TOKEN_NOT_VALID
				});
			}

			try {
				let resolvedPlaceIds = Array.isArray(placeIds) ? [...placeIds] : [];

				if ((!resolvedPlaceIds || resolvedPlaceIds.length === 0) && Array.isArray(sectionSelections) && sectionSelections.length > 0) {
					const encodedManifest = await manifestUpdateService.getEventManifest(eventId);
					const { downloadPricingFromS3 } = await import('../../util/aws.js');
					const fullManifest = await downloadPricingFromS3(encodedManifest.s3Key);
					const soldSet = new Set(encodedManifest.availability?.sold || []);
					const reservedMap = await seatReservationService.getReservedSeats(eventId);
					const reservedSet = new Set(reservedMap.keys());
					const sectionsById = new Map((fullManifest.sections || []).map((s) => [String(s.id || s._id || s.name), s]));
					const places = Array.isArray(fullManifest.places) ? fullManifest.places : [];

					for (const selection of sectionSelections) {
						const sectionId = String(selection.sectionId || '');
						const quantity = Number(selection.quantity || 0);
						if (!sectionId || quantity <= 0) continue;
						const section = sectionsById.get(sectionId);
						if (!section || resolveSectionMode(section) !== 'area') continue;

						const candidates = places.filter((p) =>
							(p.section === section.name || p.section === sectionId) &&
							!soldSet.has(p.placeId) &&
							!reservedSet.has(p.placeId)
						);
						resolvedPlaceIds.push(...candidates.slice(0, quantity).map((p) => p.placeId));
					}
				}

				if (!resolvedPlaceIds || resolvedPlaceIds.length === 0) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
						message: 'placeIds or sectionSelections are required',
						error: appText.INVALID_DATA
					});
				}

				// Check if seats are available (pass sessionId to allow same-session re-reservation)
				const availability = await seatReservationService.checkAvailability(eventId, resolvedPlaceIds, sessionId);
				if (availability.reserved.length > 0) {
					return res.status(consts.HTTP_STATUS_CONFLICT).json({
						message: 'Some seats are already reserved',
						error: 'SEATS_ALREADY_RESERVED',
						data: {
							available: availability.available,
							reserved: availability.reserved
						}
					});
				}

				// Reserve seats
				const result = await seatReservationService.reserveSeats(eventId, resolvedPlaceIds, sessionId, email);

				if (result.failed.length > 0) {
					return res.status(consts.HTTP_STATUS_CONFLICT).json({
						message: 'Some seats could not be reserved',
						error: 'RESERVATION_FAILED',
						data: result
					});
				}

				return res.status(consts.HTTP_STATUS_OK).json({
					message: 'Seats reserved successfully',
					data: {
						...result,
						resolvedPlaceIds,
						sectionSelections: sectionSelections || []
					}
				});
			} catch (err) {
				error('Error reserving seats:', err);
				next(err);
			}
		});
	} catch (err) {
		error('Error in reserveSeats:', err);
		next(err);
	}
};

/**
 * Confirm seats (update manifest, mark as sold)
 */
export const confirmSeats = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const eventId = req.params.eventId;
		const { placeIds, sectionSelections, sessionId } = req.body;

		await jwtToken.verifyJWT(token, async (err, data) => {
			if (err) {
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Please, provide valid token',
					error: appText.TOKEN_NOT_VALID
				});
			}

			try {
				// Get event to get manifest ID
				const event = await Event.findById(eventId);
				if (!event || !event.venue || !event.venue.lockedManifestId) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
						message: 'Event does not have a locked manifest',
						error: 'NO_LOCKED_MANIFEST'
					});
				}

				let resolvedPlaceIds = Array.isArray(placeIds) ? [...placeIds] : [];

				if ((!resolvedPlaceIds || resolvedPlaceIds.length === 0) && Array.isArray(sectionSelections) && sectionSelections.length > 0) {
					const encodedManifest = await manifestUpdateService.getEventManifest(eventId);
					const { downloadPricingFromS3 } = await import('../../util/aws.js');
					const fullManifest = await downloadPricingFromS3(encodedManifest.s3Key);
					const sectionsById = new Map((fullManifest.sections || []).map((s) => [String(s.id || s._id || s.name), s]));
					const places = Array.isArray(fullManifest.places) ? fullManifest.places : [];

					for (const selection of sectionSelections) {
						const sectionId = String(selection.sectionId || '');
						const quantity = Number(selection.quantity || 0);
						if (!sectionId || quantity <= 0) continue;
						const section = sectionsById.get(sectionId);
						if (!section || resolveSectionMode(section) !== 'area') continue;
						const sectionPlaces = places
							.filter((p) => p.section === section.name || p.section === sectionId)
							.map((p) => p.placeId);
						const chosen = [];
						for (const candidate of sectionPlaces) {
							const reservationSessionId = await seatReservationService.getReservation(eventId, candidate);
							if (!sessionId || reservationSessionId === sessionId) {
								chosen.push(candidate);
							}
							if (chosen.length >= quantity) break;
						}
						resolvedPlaceIds.push(...chosen);
					}
				}

				if (!resolvedPlaceIds || resolvedPlaceIds.length === 0) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
						message: 'placeIds or sectionSelections are required',
						error: appText.INVALID_DATA
					});
				}

				// Verify reservations belong to this session
				if (sessionId) {
					for (const placeId of resolvedPlaceIds) {
						const reservationSessionId = await seatReservationService.getReservation(eventId, placeId);
						if (reservationSessionId !== sessionId) {
							return res.status(consts.HTTP_STATUS_CONFLICT).json({
								message: `Seat ${placeId} is reserved by a different session`,
								error: 'SESSION_MISMATCH'
							});
						}
					}
				}

				// Mark seats as sold in manifest
				await manifestUpdateService.markSeatsAsSold(event.venue.lockedManifestId, resolvedPlaceIds);

				// Release Redis reservations
				await seatReservationService.releaseReservations(eventId, resolvedPlaceIds);

				info(`Seats confirmed for event ${eventId}: ${resolvedPlaceIds.length} seats`);

				return res.status(consts.HTTP_STATUS_OK).json({
					message: 'Seats confirmed successfully',
					data: { placeIds: resolvedPlaceIds, sectionSelections: sectionSelections || [] }
				});
			} catch (err) {
				error('Error confirming seats:', err);
				next(err);
			}
		});
	} catch (err) {
		error('Error in confirmSeats:', err);
		next(err);
	}
};

/**
 * Release seat reservations
 */
export const releaseSeats = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const eventId = req.params.eventId;
		const { placeIds } = req.body;

		if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds array is required',
				error: appText.INVALID_DATA
			});
		}

		await jwtToken.verifyJWT(token, async (err, data) => {
			if (err) {
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Please, provide valid token',
					error: appText.TOKEN_NOT_VALID
				});
			}

			try {
				// Release reservations
				const releasedCount = await seatReservationService.releaseReservations(eventId, placeIds);

				return res.status(consts.HTTP_STATUS_OK).json({
					message: 'Seat reservations released successfully',
					data: { released: releasedCount }
				});
			} catch (err) {
				error('Error releasing seats:', err);
				next(err);
			}
		});
	} catch (err) {
		error('Error in releaseSeats:', err);
		next(err);
	}
};


