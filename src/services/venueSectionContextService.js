import { Venue, Manifest } from '../../model/mongoModel.js';
import { downloadPricingFromS3 } from '../../util/aws.js';

/**
 * Section metadata (id, name, type, capacity, polygons) lives on the Venue document.
 * The S3 "pricing" manifest is often `sections: []` with only `places` for coordinates/pricing.
 * Latest venue Manifest holds `places` aligned to the venue layout; fall back to S3 places if empty.
 *
 * @param {{ venueId: string|import('mongoose').Types.ObjectId|null|undefined, s3Key?: string|null }} params
 * @returns {Promise<{ venue: object|null, sections: any[], places: any[] }>}
 */
export async function loadVenueSectionContext({ venueId, s3Key }) {
	if (!venueId) {
		return { venue: null, sections: [], places: [] };
	}
	const vid =
		typeof venueId === 'object' && venueId !== null && typeof venueId.toString === 'function'
			? venueId.toString()
			: String(venueId);

	const venue = await Venue.findById(vid).lean();
	let sections = Array.isArray(venue?.sections) ? venue.sections : [];

	const venueManifest = await Manifest.findOne({ venue: vid }).sort({ createdAt: -1 }).lean();
	let places = Array.isArray(venueManifest?.places) ? venueManifest.places : [];

	if (places.length === 0 && s3Key) {
		try {
			const s3Manifest = await downloadPricingFromS3(s3Key);
			places = Array.isArray(s3Manifest?.places) ? s3Manifest.places : [];
		} catch {
			places = [];
		}
	}

	if (sections.length === 0 && places.length > 0) {
		sections = deriveSectionsFromPlaces(places);
	}

	return { venue, sections, places };
}

/**
 * Build minimal section stubs from place.section when Venue/S3 sections arrays are empty.
 * Common for pricing_configuration manifests where layout lives in places only.
 */
export function deriveSectionsFromPlaces(places) {
	if (!Array.isArray(places) || places.length === 0) return [];

	const names = [...new Set(places.map((p) => p?.section).filter(Boolean))];
	return names.map((name) => {
		const sectionPlaces = places.filter((p) => p?.section === name);
		const hasSeatLikePlaces = sectionPlaces.some(
			(p) =>
				p?.row != null &&
				String(p.row).trim() !== '' &&
				p?.seat != null &&
				String(p.seat).trim() !== ''
		);
		return {
			id: name,
			name,
			sectionType: hasSeatLikePlaces ? 'Seating' : 'Custom',
			selectionMode: hasSeatLikePlaces ? 'seat' : 'area',
			capacity: sectionPlaces.length,
			color: '#2196F3',
		};
	});
}
