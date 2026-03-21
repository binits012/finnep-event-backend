import { EventManifest } from '../../model/mongoModel.js';
import { seatReservationService } from './seatReservationService.js';
import { downloadPricingFromS3 } from '../../util/aws.js';
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
		if (!eventManifest?.s3Key) {
			error(`[resolveSoldPlaceIdsForPayment] Missing manifest/s3Key for event ${eventId}`);
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

		const fullManifest = await downloadPricingFromS3(eventManifest.s3Key);
		const sections = Array.isArray(fullManifest?.sections) ? fullManifest.sections : [];
		const places = Array.isArray(fullManifest?.places) ? fullManifest.places : [];
		const sectionsById = new Map();
		for (const s of sections) {
			const keys = [
				s?.id,
				s?._id,
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
			if (!section || resolveSectionMode(section) !== 'area') {
				unresolvedSelections.push({ ...selection, resolved: 0, reason: 'invalid_section' });
				continue;
			}

			const sectionPlaceIds = places
				.filter((p) => (p.section === section.name || p.section === selection.sectionId) && p.placeId)
				.map((p) => p.placeId)
				.filter((placeId) => !soldSet.has(placeId) && !usedSet.has(placeId));

			const inferredCapacity = Number(section.capacity || sectionPlaceIds.length || 0);
			const currentAreaSold =
				Number(areaSoldCounts?.[String(selection.sectionId)] ?? areaSoldCounts?.[String(section.name)] ?? 0) || 0;
			const availableForSection = Math.max(0, inferredCapacity - currentAreaSold);
			const quantityToSell = Math.min(selection.quantity, availableForSection);
			if (quantityToSell > 0) {
				areaSoldIncrements.push({ sectionId: selection.sectionId, quantity: quantityToSell });
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
			`sessionId=${sessionId ? 'yes' : 'no'} unresolved=${unresolvedSelections.length}`
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
