import { EventManifest } from '../../model/mongoModel.js';
import { seatReservationService } from './seatReservationService.js';
import { loadVenueSectionContext } from './venueSectionContextService.js';
import { error, info } from '../../model/logger.js';

const resolveSectionMode = (section) => {
	if (!section) return 'seat';
	if (section.sectionType === 'Seating') return 'seat';
	if (section.selectionMode) return section.selectionMode;
	return 'area';
};

const parseArrayField = (value) => {
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [];
	const trimmed = value.trim();
	if (!trimmed || trimmed === '[]' || trimmed === 'null') return [];
	try {
		const parsed = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

const normalizePlaceIds = (input) => {
	const parsed = parseArrayField(input);
	return Array.from(
		new Set(
			parsed
				.map((id) => (typeof id === 'string' ? id.trim() : ''))
				.filter((id) => id.length > 0)
		)
	);
};

const normalizeSectionSelections = (input) => {
	const parsed = parseArrayField(input);
	return parsed
		.map((raw) => ({
			sectionId: String(raw?.sectionId || '').trim(),
			sectionName: String(raw?.sectionName || '').trim(),
			quantity: Number(raw?.quantity || 0)
		}))
		.filter((item) => (item.sectionId || item.sectionName) && item.quantity > 0);
};

/** Match seat.controller / Mongo Map or plain object */
const readAreaSoldCount = (areaSoldCounts, key) => {
	if (!key) return 0;
	if (typeof areaSoldCounts?.get === 'function') {
		const v = areaSoldCounts.get(String(key));
		return Number(v || 0) || 0;
	}
	const v = areaSoldCounts?.[String(key)];
	return Number(v || 0) || 0;
};

const stringifySectionKey = (k) => {
	if (k === null || k === undefined) return '';
	if (typeof k === 'object' && typeof k.toString === 'function') {
		const s = k.toString();
		if (s && s !== '[object Object]') return s.trim();
	}
	return String(k).trim();
};

export async function resolveSoldPlaceIdsForPayment({
	eventId,
	sessionId,
	placeIds,
	sectionSelections
}) {
	const explicitPlaceIds = normalizePlaceIds(placeIds);
	const normalizedSelections = normalizeSectionSelections(sectionSelections);

	if (!eventId || normalizedSelections.length === 0) {
		return {
			placeIds: explicitPlaceIds,
			resolvedFromSections: [],
			areaSoldIncrements: [],
			unresolvedSelections: []
		};
	}

	try {
		const eventManifest = await EventManifest.findOne({ eventId: String(eventId) }).lean();
		if (!eventManifest?.venue) {
			error(`[resolveSoldPlaceIdsForPayment] Missing manifest or venue ref for event ${eventId}`);
			return {
				placeIds: explicitPlaceIds,
				resolvedFromSections: [],
				areaSoldIncrements: [],
				unresolvedSelections: normalizedSelections.map((sel) => ({
					...sel,
					resolved: 0,
					reason: 'manifest_missing'
				}))
			};
		}

		const { venue, sections, places } = await loadVenueSectionContext({
			venueId: eventManifest.venue,
			s3Key: eventManifest.s3Key
		});
		if (!venue || !Array.isArray(venue.sections) || venue.sections.length === 0) {
			error(`[resolveSoldPlaceIdsForPayment] Venue or venue.sections missing for event ${eventId}`);
			return {
				placeIds: explicitPlaceIds,
				resolvedFromSections: [],
				areaSoldIncrements: [],
				unresolvedSelections: normalizedSelections.map((sel) => ({
					...sel,
					resolved: 0,
					reason: 'venue_missing'
				}))
			};
		}
		const sectionsById = new Map();
		for (const s of sections) {
			const keys = [
				s?.id,
				s?._id?.toString(),
				s?.name,
				typeof s?.name === 'string' ? s.name.toLowerCase() : null
			]
				.filter((k) => k !== null && k !== undefined)
				.map((k) => String(k).trim())
				.filter((k) => k.length > 0);
			for (const k of keys) {
				if (!sectionsById.has(k)) sectionsById.set(k, s);
			}
		}
		info(`[resolveSoldPlaceIdsForPayment] venue sections: ${sections.map((s) => JSON.stringify({ id: s.id, name: s.name, sectionType: s.sectionType, selectionMode: s.selectionMode })).join(', ')}`);
		const soldSet = new Set(eventManifest?.availability?.sold || []);
		const areaSoldCounts = eventManifest?.availability?.areaSoldCounts || {};
		const reservedMap = await seatReservationService.getReservedSeats(String(eventId));
		const usedSet = new Set(explicitPlaceIds);
		const resolvedFromSections = [];
		const areaSoldIncrements = [];
		const unresolvedSelections = [];

		for (const selection of normalizedSelections) {
			const sectionIdKey = (selection.sectionId || '').trim();
			const sectionNameKey = (selection.sectionName || '').trim();
			const section =
				(sectionIdKey
					? sectionsById.get(sectionIdKey) || sectionsById.get(sectionIdKey.toLowerCase())
					: null) ||
				(sectionNameKey
					? sectionsById.get(sectionNameKey) || sectionsById.get(sectionNameKey.toLowerCase())
					: null);
			if (section && resolveSectionMode(section) !== 'area') {
				unresolvedSelections.push({ ...selection, resolved: 0, reason: 'invalid_section' });
				continue;
			}

			// Same canonical key as seat map (normalizeAreaSections). If section lookup fails due id drift,
			// fallback to client keys so standing counters can still be persisted.
			const areaCounterKey = String(
				section?.id ||
					(typeof section?._id?.toString === 'function' ? section._id.toString() : section?._id) ||
					section?.name ||
					selection.sectionId ||
					selection.sectionName ||
					''
			).trim();

			const sectionPlaceIds = places
				.filter((p) => {
					if (!p?.placeId) return false;
					const ps = String(p.section || '').trim();
					if (!ps) return false;
					const candidateKeys = [
						section?.name,
						section?.id,
						section?._id,
						selection.sectionId,
						selection.sectionName
					]
						.map((k) => stringifySectionKey(k))
						.filter((k) => k.length > 0);
					return candidateKeys.includes(ps);
				})
				.map((p) => p.placeId)
				.filter((placeId) => !soldSet.has(placeId) && !usedSet.has(placeId));

			const inferredCapacity = Number(section?.capacity || sectionPlaceIds.length || 0);
			const currentAreaSold =
				readAreaSoldCount(areaSoldCounts, areaCounterKey) ||
				readAreaSoldCount(areaSoldCounts, section?.name) ||
				readAreaSoldCount(areaSoldCounts, selection.sectionId) ||
				readAreaSoldCount(areaSoldCounts, selection.sectionName) ||
				0;
			const availableForSection = Math.max(0, inferredCapacity - currentAreaSold);
			const quantityToSell = Math.min(selection.quantity, availableForSection);
			if (!section && sectionPlaceIds.length === 0) {
				unresolvedSelections.push({ ...selection, resolved: 0, reason: 'invalid_section' });
				continue;
			}
			if (quantityToSell > 0 && areaCounterKey) {
				areaSoldIncrements.push({ sectionId: areaCounterKey, quantity: quantityToSell });
			}

			// Prefer reservations owned by this payment session, but if reservation TTL expired
			// before payment finalization, fill from currently unreserved seats in the same area.
			const reservedBySession = sessionId
				? sectionPlaceIds.filter((placeId) => reservedMap.get(placeId) === sessionId)
				: [];
			const unreserved = sectionPlaceIds.filter((placeId) => !reservedMap.has(placeId));
			const hasUniqueSectionPlaceIds = new Set(sectionPlaceIds).size === sectionPlaceIds.length;
			const candidates = sessionId
				? [...reservedBySession, ...unreserved.filter((placeId) => !reservedBySession.includes(placeId))]
				: unreserved;

			const picked = hasUniqueSectionPlaceIds ? candidates.slice(0, quantityToSell) : [];
			for (const placeId of picked) {
				usedSet.add(placeId);
			}
			resolvedFromSections.push(...picked);

			if (quantityToSell < selection.quantity) {
				unresolvedSelections.push({
					...selection,
					resolved: quantityToSell,
					reason: 'insufficient_capacity'
				});
			} else if (picked.length < quantityToSell) {
				const pickedFromSession = sessionId
					? picked.filter((placeId) => reservedMap.get(placeId) === sessionId).length
					: 0;
				unresolvedSelections.push({
					...selection,
					resolved: picked.length,
					reason: sessionId
						? `session_reservations_missing(session=${pickedFromSession},fallback=${picked.length - pickedFromSession})`
						: 'insufficient_unreserved'
				});
			}
		}

		const finalPlaceIds = Array.from(new Set([...explicitPlaceIds, ...resolvedFromSections]));

		info(
			`[resolveSoldPlaceIdsForPayment] event=${eventId} explicit=${explicitPlaceIds.length} ` +
			`fromSections=${resolvedFromSections.length} total=${finalPlaceIds.length} ` +
			`sessionId=${sessionId ? 'yes' : 'no'} unresolved=${unresolvedSelections.length} ` +
			`requestedAreas=${normalizedSelections.length} areaIncrements=${areaSoldIncrements.length}`
		);

		return {
			placeIds: finalPlaceIds,
			resolvedFromSections,
			areaSoldIncrements,
			unresolvedSelections
		};
	} catch (err) {
		error(`[resolveSoldPlaceIdsForPayment] Failed for event ${eventId}:`, err);
		return {
			placeIds: explicitPlaceIds,
			resolvedFromSections: [],
			areaSoldIncrements: [],
			unresolvedSelections: normalizedSelections.map((sel) => ({
				...sel,
				resolved: 0,
				reason: 'resolver_error'
			}))
		};
	}
}
