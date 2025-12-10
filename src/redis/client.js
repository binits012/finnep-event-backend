import redisClient from '../../model/redisConnect.js';
import { error, info } from '../../model/logger.js';

/**
 * Redis client wrapper for seat reservations
 * Key format: seat_reservation:{eventId}:{base64Email}:{placeId}
 * Value: sessionId (UUID)
 * TTL: 600 seconds (10 minutes)
 */
class SeatReservationClient {
	/**
	 * Encode email to base64 for use in Redis key
	 * @param {string} email - Email address
	 * @returns {string} Base64 encoded email
	 */
	_encodeEmail(email) {
		if (!email) return '';
		return Buffer.from(email.toLowerCase().trim()).toString('base64');
	}

	/**
	 * Set a seat reservation
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place/Seat ID
	 * @param {string} sessionId - Session ID (UUID)
	 * @param {string} email - Email address (verified via OTP)
	 * @returns {Promise<boolean>} - True if reservation was set successfully
	 */
	async setReservation(eventId, placeId, sessionId, email) {
		try {
			const ttl = 600; // 10 minutes in seconds

			// Use a unified availability key to prevent multiple reservations of the same seat
			const availabilityKey = `seat_availability:${eventId}:${placeId}`;
			const detailsKey = `seat_reservation_details:${eventId}:${placeId}`;

			// Check if seat is already reserved by anyone
			const existingReservation = await redisClient.get(availabilityKey);

			if (existingReservation !== null) {
				// Seat is already reserved - check if it's by the same user
				const reservationDetails = await redisClient.get(detailsKey);
				let details = null;

				try {
					details = reservationDetails ? JSON.parse(reservationDetails) : null;
				} catch (e) {
					// Invalid JSON, treat as unknown reservation
				}

				if (details) {
					// Check if same user (email takes precedence over sessionId)
					let isSameUser = false;

					if (email && details.email) {
						// Both have email - compare emails
						isSameUser = details.email === email;
					} else if (email && !details.email) {
						// Current request has email but stored reservation doesn't - can't be same user
						isSameUser = false;
					} else if (!email && details.email) {
						// Current request has no email but stored has email - can't be same user
						isSameUser = false;
					} else {
						// Neither has email - compare sessionIds
						isSameUser = details.sessionId === sessionId;
					}

					if (isSameUser) {
						// Same user - update reservation details and extend TTL
						const updatedDetails = JSON.stringify({
							sessionId,
							email: email || details.email || null,
							timestamp: Date.now()
						});

						const multi = redisClient.multi();
						multi.set(detailsKey, updatedDetails, { EX: ttl });
						multi.expire(availabilityKey, ttl);

						const results = await multi.exec();
						if (results && results[0] === 'OK') {
							info(`Seat reservation extended: ${availabilityKey} for user ${email || sessionId}`);
							return true;
						}
						return false;
					} else {
						// Different user - seat is taken
						info(`Seat ${placeId} already reserved by different user (current: ${email || sessionId}, existing: ${details.email || details.sessionId})`);
						return false;
					}
				} else {
					// No details available - assume it's reserved by someone else
					info(`Seat ${placeId} already reserved (no details available)`);
					return false;
				}
			} else {
				// Seat is available - create reservation
				const reservationDetails = JSON.stringify({
					sessionId,
					email: email || null,
					timestamp: Date.now()
				});

				// Use MULTI to ensure atomicity
				const multi = redisClient.multi();
				multi.set(availabilityKey, email || sessionId, { NX: true, EX: ttl });
				multi.set(detailsKey, reservationDetails, { EX: ttl });

				const results = await multi.exec();

				if (results && results[0] === 'OK' && results[1] === 'OK') {
					info(`Seat reservation created: ${availabilityKey} for user ${email || sessionId}`);
					return true;
				} else {
					info(`Failed to reserve seat ${placeId} - race condition or already reserved`);
					return false;
				}
			}
		} catch (err) {
			error(`Error setting seat reservation for ${eventId}:${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Get a seat reservation
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place/Seat ID
	 * @param {string} [email] - Optional email to check specific user's reservation
	 * @returns {Promise<string|null>} - Session ID if reserved, null otherwise
	 */
	async getReservation(eventId, placeId, email = null) {
		try {
			const availabilityKey = `seat_availability:${eventId}:${placeId}`;

			// Check if seat is reserved
			const reservationHolder = await redisClient.get(availabilityKey);

			if (reservationHolder === null) {
				// Seat is not reserved
				return null;
			}

			// Seat is reserved - get details to check ownership
			const detailsKey = `seat_reservation_details:${eventId}:${placeId}`;
			const reservationDetails = await redisClient.get(detailsKey);

			if (reservationDetails) {
				try {
					const details = JSON.parse(reservationDetails);

					if (email) {
						// Check if reserved by specific email
						return details.email === email ? details.sessionId : null;
					} else {
						// Return session ID of whoever reserved it
						return details.sessionId;
					}
				} catch (e) {
					// Invalid JSON in details
					error(`Invalid reservation details for ${eventId}:${placeId}`);
					return reservationHolder; // Fallback to availability key value
				}
			} else {
				// No details available, return the holder from availability key
				return reservationHolder;
			}
		} catch (err) {
			error(`Error getting seat reservation for ${eventId}:${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Delete a seat reservation
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place/Seat ID
	 * @param {string} [email] - Optional email to delete specific user's reservation
	 * @returns {Promise<boolean>} - True if reservation was deleted
	 */
	async deleteReservation(eventId, placeId, email = null) {
		try {
			const availabilityKey = `seat_availability:${eventId}:${placeId}`;
			const detailsKey = `seat_reservation_details:${eventId}:${placeId}`;

			// Check if seat is reserved and get details
			const reservationDetails = await redisClient.get(detailsKey);

			if (reservationDetails) {
				try {
					const details = JSON.parse(reservationDetails);

					// Check if we should delete this reservation
					const shouldDelete = !email || details.email === email;

					if (shouldDelete) {
						// Use MULTI to delete both keys atomically
						const multi = redisClient.multi();
						multi.del(availabilityKey);
						multi.del(detailsKey);

						const results = await multi.exec();
						const deletedCount = results ? results.filter(r => r > 0).length : 0;

						if (deletedCount > 0) {
							info(`Seat reservation deleted: ${availabilityKey}`);
							return true;
						}
					}
				} catch (e) {
					// Invalid JSON, try to delete anyway
					error(`Invalid reservation details for ${eventId}:${placeId}, deleting anyway`);
					const result = await redisClient.del([availabilityKey, detailsKey]);
					return result > 0;
				}
			} else {
				// No details, just try to delete availability key
				const result = await redisClient.del(availabilityKey);
				return result > 0;
			}

			return false;
		} catch (err) {
			error(`Error deleting seat reservation for ${eventId}:${placeId}:`, err);
			throw err;
		}
	}

	/**
	 * Delete multiple seat reservations
	 * @param {string} eventId - Event ID
	 * @param {string[]} placeIds - Array of place IDs
	 * @param {string} [email] - Optional email to delete specific user's reservations
	 * @returns {Promise<number>} - Number of reservations deleted
	 */
	async deleteReservations(eventId, placeIds, email = null) {
		try {
			if (!placeIds || placeIds.length === 0) {
				return 0;
			}

			let totalDeleted = 0;

			for (const placeId of placeIds) {
				const availabilityKey = `seat_availability:${eventId}:${placeId}`;
				const detailsKey = `seat_reservation_details:${eventId}:${placeId}`;

				// Check if seat is reserved and get details
				const reservationDetails = await redisClient.get(detailsKey);

				if (reservationDetails) {
					try {
						const details = JSON.parse(reservationDetails);

						// Check if we should delete this reservation
						const shouldDelete = !email || details.email === email;

						if (shouldDelete) {
							// Use MULTI to delete both keys atomically
							const multi = redisClient.multi();
							multi.del(availabilityKey);
							multi.del(detailsKey);

							const results = await multi.exec();
							const deletedCount = results ? results.filter(r => r > 0).length : 0;
							totalDeleted += deletedCount;
						}
					} catch (e) {
						// Invalid JSON, try to delete anyway
						const result = await redisClient.del([availabilityKey, detailsKey]);
						totalDeleted += result;
					}
				} else {
					// No details, just try to delete availability key
					const result = await redisClient.del(availabilityKey);
					totalDeleted += result;
				}
			}

			info(`Deleted ${totalDeleted} seat reservations for event ${eventId}${email ? ` (email: ${email})` : ''}`);
			return totalDeleted;
		} catch (err) {
			error(`Error deleting seat reservations for ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Get all reservations for an event
	 * @param {string} eventId - Event ID
	 * @returns {Promise<Map<string, string>>} - Map of placeId -> sessionId
	 */
	async getAllReservations(eventId) {
		try {
			const pattern = `seat_availability:${eventId}:*`;

			// Find all availability keys for this event
			const keys = await redisClient.keys(pattern);

			if (!keys || keys.length === 0) {
				return new Map();
			}

			const reservations = new Map();

			for (const key of keys) {
				// Key format: seat_availability:{eventId}:{placeId}
				const parts = key.split(':');
				const placeId = parts[2]; // Extract placeId from key (3rd part)

				// Get reservation details
				const detailsKey = `seat_reservation_details:${eventId}:${placeId}`;
				const reservationDetails = await redisClient.get(detailsKey);

				if (reservationDetails) {
					try {
						const details = JSON.parse(reservationDetails);
						reservations.set(placeId, details.sessionId);
					} catch (e) {
						// Invalid JSON, use availability key value as fallback
						const sessionId = await redisClient.get(key);
						if (sessionId) {
							reservations.set(placeId, sessionId);
						}
					}
				} else {
					// No details available, use availability key value
					const sessionId = await redisClient.get(key);
					if (sessionId) {
						reservations.set(placeId, sessionId);
					}
				}
			}

			return reservations;
		} catch (err) {
			error(`Error getting all reservations for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Check if a seat is reserved
	 * @param {string} eventId - Event ID
	 * @param {string} placeId - Place/Seat ID
	 * @param {string} [email] - Optional email to check specific user's reservation
	 * @returns {Promise<boolean>} - True if seat is reserved
	 */
	async isReserved(eventId, placeId, email = null) {
		try {
			const sessionId = await this.getReservation(eventId, placeId, email);
			return sessionId !== null;
		} catch (err) {
			error(`Error checking reservation for ${eventId}:${placeId}:`, err);
			throw err;
		}
	}
}

// Export singleton instance
export const seatReservationClient = new SeatReservationClient();
export default seatReservationClient;

