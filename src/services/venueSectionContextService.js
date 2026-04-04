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
	const sections = Array.isArray(venue?.sections) ? venue.sections : [];

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

	return { venue, sections, places };
}
