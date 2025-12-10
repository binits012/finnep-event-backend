import { seatReservationClient } from '../redis/client.js';
import { error, info } from '../../model/logger.js';

/**
 * Seat Reservation Service
 * Manages temporary seat reservations using Redis (7 min TTL)
 */
export class SeatReservationService {
	/**
	 * Reserve seats for an event
	 * @param {string} eventId - Event ID
	 * @param {string[]} placeIds - Array of place IDs to reserve
	 * @param {string} sessionId - Session ID (UUID)
	 * @param {string} email - Email address (verified via OTP)
	 * @returns {Promise<Object>} { reserved: [string], failed: [string] }
	 */
	async reserveSeats(eventId, placeIds, sessionId, email) {
		try {
			if (!eventId || !placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
				throw new Error('Invalid parameters: eventId and placeIds array are required');
			}

			if (!sessionId) {
				throw new Error('Session ID is required');
			}

			// Email is optional for backward compatibility during seat selection
			// but required for final reservation after OTP verification

			const reserved = [];
			const failed = [];

			// Try to reserve each seat
			const successfulReservations = [];
			for (const placeId of placeIds) {
				const success = await seatReservationClient.setReservation(eventId, placeId, sessionId, email);
				if (success) {
					successfulReservations.push({
						placeId,
						sessionId,
						email: email || undefined
					});
					reserved.push(placeId);
				} else {
					failed.push(placeId);
				}
			}


			info(`Seat reservations for event ${eventId} (email: ${email}): ${reserved.length} reserved, ${failed.length} failed`);

			return {
				reserved: reserved,
				failed: failed
			};
		} catch (err) {
			error(`Error reserving seats for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Check if a seat is reserved
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place ID
	 * @param {string} [email] - Optional email to check specific user's reservation
	 * @returns {Promise<boolean>} True if reserved
	 */
	async checkReservation(eventId, placeId, email = null) {
		try {
			return await seatReservationClient.isReserved(eventId, placeId, email);
		} catch (err) {
			error(`Error checking reservation for event ${eventId}, place ${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Get reservation session ID for a seat
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place ID
	 * @param {string} [email] - Optional email to get specific user's reservation
	 * @returns {Promise<string|null>} Session ID if reserved, null otherwise
	 */
	async getReservation(eventId, placeId, email = null) {
		try {
			return await seatReservationClient.getReservation(eventId, placeId, email);
		} catch (err) {
			error(`Error getting reservation for event ${eventId}, place ${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Release a seat reservation
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place ID
	 * @param {string} [email] - Optional email to release specific user's reservation
	 * @returns {Promise<boolean>} True if released
	 */
	async releaseReservation(eventId, placeId, email = null) {
		try {
			return await seatReservationClient.deleteReservation(eventId, placeId, email);
		} catch (err) {
			error(`Error releasing reservation for event ${eventId}, place ${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Release multiple seat reservations
	 * @param {string} eventId - Event ID
	 * @param {string[]} placeIds - Array of place IDs
	 * @param {string} [email] - Optional email to release specific user's reservations
	 * @returns {Promise<number>} Number of reservations released
	 */
	async releaseReservations(eventId, placeIds, email = null) {
		try {
			// Release Redis reservations
			return await seatReservationClient.deleteReservations(eventId, placeIds, email);
		} catch (err) {
			error(`Error releasing reservations for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Get all reserved seats for an event
	 * @param {string} eventId - Event ID
	 * @returns {Promise<Map<string, string>>} Map of placeId -> sessionId
	 */
	async getReservedSeats(eventId) {
		try {
			return await seatReservationClient.getAllReservations(eventId);
		} catch (err) {
			error(`Error getting reserved seats for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Check if multiple seats are available (not reserved by another user)
	 * @param {string} eventId - Event ID
	 * @param {string[]} placeIds - Array of place IDs
	 * @param {string} [sessionId] - Optional session ID - if provided, seats reserved by this session are treated as available
	 * @param {string} [email] - Optional email - if provided, seats reserved by this email are treated as available
	 * @returns {Promise<Object>} { available: [string], reserved: [string] }
	 */
	async checkAvailability(eventId, placeIds, sessionId = null, email = null) {
		try {
			const available = [];
			const reserved = [];

			for (const placeId of placeIds) {
				// First check if seat is reserved at all
				const anyReservation = await this.getReservation(eventId, placeId);

				if (anyReservation === null) {
					// Not reserved at all - available
					available.push(placeId);
				} else {
					// Seat is reserved - check if it's by the current user
					let isCurrentUserReservation = false;

					if (email) {
						// Check if reserved by the specific email
						const emailReservation = await this.getReservation(eventId, placeId, email);
						isCurrentUserReservation = (emailReservation !== null);
					} else if (sessionId) {
						// Check if the reservation sessionId matches current sessionId
						isCurrentUserReservation = (anyReservation === sessionId);
					}

					if (isCurrentUserReservation) {
						// Reserved by current user - treat as available (can extend/re-reserve)
						available.push(placeId);
					} else {
						// Reserved by different user - not available
						reserved.push(placeId);
					}
				}
			}

			return {
				available: available,
				reserved: reserved
			};
		} catch (err) {
			error(`Error checking availability for event ${eventId}:`, err);
			throw err;
		}
	}
}

// Export singleton instance
export const seatReservationService = new SeatReservationService();
export default seatReservationService;

