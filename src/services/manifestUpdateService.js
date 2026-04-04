import { EventManifest } from '../../model/mongoModel.js';
import { manifestEncoderService } from './manifestEncoderService.js';
import { seatReservationService } from './seatReservationService.js';
import { error, info } from '../../model/logger.js';

/**
 * Manifest Update Service
 * Manages manifest updates for seat availability and pricing
 */
export class ManifestUpdateService {
	/**
	 * Mark seats as sold in the manifest
	 * @param {string} manifestId - MongoDB Manifest ID
	 * @param {string[]} placeIds - Array of place IDs to mark as sold
	 * @returns {Promise<Object>} Updated manifest
	 */
	async markSeatsAsSold(manifestId, placeIds) {
		try {
			if (!manifestId || !placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
				throw new Error('Invalid parameters: manifestId and placeIds array are required');
			}

			const manifest = await EventManifest.findById(manifestId);
			if (!manifest) {
				throw new Error(`Event manifest not found: ${manifestId}`);
			}

			if (!manifest.availability) {
				// Initialize availability if not present
				manifest.availability = { sold: [] };
			}

		// Add placeIds to sold array (avoid duplicates)
		const currentSold = new Set(manifest.availability.sold || []);
		let actuallyMarked = 0;
		let skipped = 0;

		for (const placeId of placeIds) {
			// Validate placeId exists in manifest
			if (!manifest.placeIds || !manifest.placeIds.includes(placeId)) {
				error(`PlaceId ${placeId} not found in event manifest ${manifestId}. Manifest has ${manifest.placeIds?.length || 0} placeIds.`);
				skipped++;
				continue;
			}
			const wasAlreadySold = currentSold.has(placeId);
			currentSold.add(placeId);
			if (!wasAlreadySold) {
				actuallyMarked++;
			}
		}

		// Update manifest
		manifest.availability.sold = Array.from(currentSold);
		manifest.updatedAt = new Date();

		const updatedManifest = await manifest.save();

		if (skipped > 0) {
			error(`Failed to mark ${skipped} seat(s) as sold in event manifest ${manifestId} - placeIds not found in manifest. Only marked ${actuallyMarked} seat(s).`);
		}
		info(`Marked ${actuallyMarked} seat(s) as sold in event manifest ${manifestId}. Total sold: ${updatedManifest.availability.sold.length} (${skipped} skipped, ${placeIds.length} attempted)`);

			return updatedManifest;
		} catch (err) {
			error(`Error marking seats as sold in event manifest ${manifestId}:`, err);
			throw err;
		}
	}

	/**
	 * Increment sold counters for area/standing sections.
	 * @param {string} manifestId - MongoDB Manifest ID
	 * @param {Array<{sectionId: string, quantity: number}>} areaSelections
	 * @returns {Promise<Object>} Updated manifest
	 */
	async markAreaSelectionsSold(manifestId, areaSelections) {
		try {
			if (!manifestId || !Array.isArray(areaSelections) || areaSelections.length === 0) {
				throw new Error('Invalid parameters: manifestId and areaSelections are required');
			}

			const manifest = await EventManifest.findById(manifestId);
			if (!manifest) {
				throw new Error(`Event manifest not found: ${manifestId}`);
			}

			if (!manifest.availability) {
				manifest.availability = { sold: [], areaSoldCounts: {} };
			}

			if (!manifest.availability.areaSoldCounts) {
				manifest.availability.areaSoldCounts = new Map();
			}

			// Be defensive: older manifests can hold plain objects instead of a Mongoose Map.
			// Normalize to a Map so get/set calls below always work.
			if (
				typeof manifest.availability.areaSoldCounts?.get !== 'function' ||
				typeof manifest.availability.areaSoldCounts?.set !== 'function'
			) {
				const source = manifest.availability.areaSoldCounts || {};
				const normalized = new Map();
				for (const [k, v] of Object.entries(source)) {
					normalized.set(String(k), Number(v || 0) || 0);
				}
				manifest.availability.areaSoldCounts = normalized;
			}

			let totalIncremented = 0;
			for (const sel of areaSelections) {
				const sectionId = String(sel?.sectionId || '').trim();
				const quantity = Number(sel?.quantity || 0);
				if (!sectionId || quantity <= 0) continue;

				const current = Number(manifest.availability.areaSoldCounts.get(sectionId) || 0);
				manifest.availability.areaSoldCounts.set(sectionId, current + quantity);
				totalIncremented += quantity;
			}

			manifest.updatedAt = new Date();
			const updatedManifest = await manifest.save();
			if (totalIncremented <= 0) {
				info(`No area sold counters incremented for event manifest ${manifestId}; selections=${JSON.stringify(areaSelections)}`);
			}
			info(`Incremented area sold counters by ${totalIncremented} on event manifest ${manifestId}`);
			return updatedManifest;
		} catch (err) {
			error(`Error incrementing area sold counters for event manifest ${manifestId}:`, err);
			throw err;
		}
	}


	/**
	 * Get event manifest
	 * @param {string} eventId - Event ID
	 * @returns {Promise<Object|null>} Encoded manifest or null
	 */
	async getEventManifest(eventId) {
		try {
			// Get event manifest from EventManifest collection (separate from venue Manifest)
			const manifest = await EventManifest.findOne({
				eventId: eventId
			});

			return manifest;
		} catch (err) {
			error(`Error getting event manifest for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Get available seats for an event (merge manifest + Redis reservations)
	 * @param {string} eventId - Event ID
	 * @returns {Promise<Object>} { available: [string], reserved: [string], sold: [string] }
	 */
	async getAvailableSeats(eventId) {
		try {
			// Get encoded manifest
			const manifest = await this.getEventManifest(eventId);
			if (!manifest) {
				throw new Error(`Manifest not found for event ${eventId}`);
			}

			// Get sold seats from manifest
			const sold = new Set(manifest.availability?.sold || []);

			// Get reserved seats from Redis
			const reservedMap = await seatReservationService.getReservedSeats(eventId);
			const reserved = new Set(reservedMap.keys());

			// Calculate available seats
			const allPlaceIds = manifest.placeIds || [];
			const available = allPlaceIds.filter(placeId => {
				return !sold.has(placeId) && !reserved.has(placeId);
			});

			return {
				available: available,
				reserved: Array.from(reserved),
				sold: Array.from(sold),
				total: allPlaceIds.length
			};
		} catch (err) {
			error(`Error getting available seats for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Check if a seat is available (not sold and not reserved)
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place ID
	 * @returns {Promise<boolean>} True if available
	 */
	async isSeatAvailable(eventId, placeId) {
		try {
			// Get encoded manifest
			const manifest = await this.getEventManifest(eventId);
			if (!manifest) {
				return false;
			}

			// Check if placeId exists in manifest
			if (!manifest.placeIds || !manifest.placeIds.includes(placeId)) {
				return false;
			}

			// Check if sold
			const sold = manifest.availability?.sold || [];
			if (sold.includes(placeId)) {
				return false;
			}

			// Check if reserved
			const isReserved = await seatReservationService.checkReservation(eventId, placeId);
			if (isReserved) {
				return false;
			}

			return true;
		} catch (err) {
			error(`Error checking seat availability for event ${eventId}, place ${placeId}:`, err);
			return false;
		}
	}

	/**
	 * Get price for a placeId using partition lookup
	 * @param {string} manifestId - Manifest ID
	 * @param {string} placeId - Place ID
	 * @returns {Promise<number|null>} Price in cents, or null if not found
	 */
	async getPriceForPlaceId(manifestId, placeId) {
		try {
			const manifest = await EventManifest.findById(manifestId);
			if (!manifest) {
				return null;
			}

			return manifestEncoderService.getPriceForPlaceId(manifest, placeId);
		} catch (err) {
			error(`Error getting price for placeId ${placeId} in event manifest ${manifestId}:`, err);
			return null;
		}
	}

	/**
	 * Get price for a placeId by event ID
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place ID
	 * @returns {Promise<number|null>} Price in cents, or null if not found
	 */
	async getPriceForPlaceIdByEvent(eventId, placeId) {
		try {
			const manifest = await this.getEventManifest(eventId);
			if (!manifest) {
				return null;
			}

			return manifestEncoderService.getPriceForPlaceId(manifest, placeId);
		} catch (err) {
			error(`Error getting price for placeId ${placeId} in event ${eventId}:`, err);
			return null;
		}
	}
}

// Export singleton instance
export const manifestUpdateService = new ManifestUpdateService();
export default manifestUpdateService;

