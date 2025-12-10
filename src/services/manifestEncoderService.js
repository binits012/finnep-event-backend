import { error, info } from '../../model/logger.js';
import crypto from 'crypto';

/**
 * Manifest Encoder Service
 * Converts full manifest (with places array) to Ticketmaster-encoded format
 * for efficient storage and availability tracking
 */
export class ManifestEncoderService {
	/**
	 * Encode a full manifest to Ticketmaster format
	 * Returns minimal Ticketmaster-compatible format: eventId, updateHash, updateTime, placeIds, partitions
	 * Full venue configuration (sections, backgroundSvg, places with coordinates) should remain in Venue collection
	 * @param {Object} fullManifest - Full manifest with places array
	 * @param {Object} pricingConfig - Pricing configuration (Map of section/zone -> price)
	 * @returns {Object} Encoded manifest in Ticketmaster format (minimal structure)
	 */
	encodeManifest(fullManifest, pricingConfig = {}) {
		try {
			if (!fullManifest || !fullManifest.places || !Array.isArray(fullManifest.places)) {
				throw new Error('Invalid manifest: places array is required');
			}

			// 1. Sort places by section → row → seat for consistent ordering
			const sortedPlaces = this._sortPlaces(fullManifest.places);

		// 2. Generate Ticketmaster-style encoded placeIds
		// Format: VENUE_PREFIX(4) + SECTION_CHAR(1) + POSITION_CODE(6-8)
		// Ticketmaster uses longer encoded strings (e.g., "JUWUETZ2GIYDUNRYHA") instead of simple hex
		// Store mapping: originalPlaceId -> encodedPlaceId for client lookup
		// Extract venueId (could be ObjectId object or string)
		let venueId = fullManifest.venue || null;
		if (venueId && typeof venueId === 'object' && venueId.toString) {
			venueId = venueId.toString();
		} else if (venueId) {
			venueId = String(venueId);
		}
		const { placeIds, placeIdMapping, pricingConfig: encodedPricingConfig } = this._generateTicketmasterPlaceIds(sortedPlaces, venueId);

			// 3. Calculate partitions (price change boundaries) - Ticketmaster format only uses partitions
			// Note: pricingZones are calculated but not included in Ticketmaster format output
			// Use sortedPlaces with original placeIds for partition calculation
			const { partitions } = this.calculatePartitions(sortedPlaces, pricingConfig);

			// 4. Generate updateHash from sorted placeIds (Ticketmaster format)
			const updateHash = this._generateUpdateHash(placeIds);

			// 5. Build minimal Ticketmaster-format encoded manifest
			// Includes: eventId, updateHash, updateTime, placeIds, partitions, pricingConfig
			// Full venue configuration (sections, backgroundSvg, places with coordinates) stays in Venue collection
			const encodedManifest = {
				eventId: fullManifest.eventId || null,
				updateHash: updateHash,
				updateTime: fullManifest.updateTime || Date.now(),
				placeIds: placeIds,
				partitions: partitions,
				pricingConfig: encodedPricingConfig, // Pricing configuration with tier mappings
				// Store mapping internally for lookups (not part of Ticketmaster format, but needed)
				_placeIdMapping: placeIdMapping
			};

			info(`Manifest encoded (Ticketmaster format): ${placeIds.length} places, ${partitions.length} partitions`);
			return encodedManifest;
		} catch (err) {
			error('Error encoding manifest:', err);
			throw err;
		}
	}

	/**
	 * Base64 URL-safe encode
	 * @param {string} str - String to encode
	 * @returns {string} Base64URL encoded string
	 */
	_base64UrlEncode(str) {
		return Buffer.from(str, 'utf8')
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
	}

	/**
	 * Get price for a placeId using partition lookup
	 * @param {Object} encodedManifest - Encoded manifest
	 * @param {string} placeId - Place ID to lookup
	 * @returns {number|null} - Price in cents, or null if not found
	 */
	getPriceForPlaceId(encodedManifest, placeId) {
		try {
			if (!encodedManifest || !encodedManifest.placeIds || !encodedManifest.partitions) {
				return null;
			}

			const placeIndex = encodedManifest.placeIds.indexOf(placeId);
			if (placeIndex === -1) {
				return null;
			}

			// Find which partition this place belongs to
			const partitionIndex = this._findPartitionIndex(placeIndex, encodedManifest.partitions);

			if (partitionIndex === -1 || !encodedManifest.pricingZones || partitionIndex >= encodedManifest.pricingZones.length) {
				return null;
			}

			return encodedManifest.pricingZones[partitionIndex].price;
		} catch (err) {
			error(`Error getting price for placeId ${placeId}:`, err);
			return null;
		}
	}

	/**
	 * Calculate partitions (price change boundaries) and pricing zones
	 * @param {Array} places - Sorted array of places
	 * @param {Object} pricingConfig - Pricing configuration (Map of section/zone -> price)
	 * @returns {Object} { partitions: [Number], pricingZones: [Object] }
	 */
	calculatePartitions(places, pricingConfig = {}) {
		if (!places || places.length === 0) {
			return { partitions: [], pricingZones: [] };
		}

		const partitions = [];
		const pricingZones = [];
		let currentPrice = null;
		let currentSection = null;
		let zoneStart = 0;

		for (let i = 0; i < places.length; i++) {
			const place = places[i];

			// Determine price for this place
			// Priority: 1) pricingConfig by section, 2) place.pricing.currentPrice, 3) place.pricing.basePrice
			let price = null;
			const section = place.section || 'default';

			if (pricingConfig && typeof pricingConfig.get === 'function') {
				// pricingConfig is a Map
				price = pricingConfig.get(section) || pricingConfig.get(place.zone) || null;
			} else if (pricingConfig && pricingConfig[section]) {
				// pricingConfig is a plain object
				price = pricingConfig[section] || pricingConfig[place.zone] || null;
			}

			if (price === null) {
				// Try currentPrice first (already calculated total)
				if (place.pricing?.currentPrice) {
					price = place.pricing.currentPrice;
				} else if (place.pricing) {
					// Calculate total price from place pricing: basePrice + serviceFee + tax
					const basePrice = place.pricing.basePrice || 0;
					const serviceFee = place.pricing.serviceFee || 0;
					const tax = place.pricing.tax !== undefined ? place.pricing.tax : (place.pricing.vat !== undefined ? place.pricing.vat : 0);
					price = basePrice + serviceFee + tax;
				} else {
					price = 0;
				}
			}

			// Convert to cents if needed (assume price is in euros if < 1000)
			if (price < 1000) {
				price = Math.round(price * 100);
			}

			// Check if price or section changed (new partition)
			if (currentPrice !== price || currentSection !== section) {
				// If this is not the first place, close the previous zone
				if (i > 0) {
					pricingZones.push({
						start: zoneStart,
						end: i - 1,
						price: currentPrice,
						currency: places[zoneStart].pricing?.currency || 'EUR',
						section: currentSection || 'default'
					});
					partitions.push(i); // Partition starts at this index
				}

				// Start new zone
				zoneStart = i;
				currentPrice = price;
				currentSection = section;
			}
		}

		// Close the last zone
		if (places.length > 0) {
			pricingZones.push({
				start: zoneStart,
				end: places.length - 1,
				price: currentPrice,
				currency: places[zoneStart].pricing?.currency || 'EUR',
				section: currentSection || 'default'
			});
		}

		return { partitions, pricingZones };
	}

	/**
	 * Sort places by section → row → seat
	 * @private
	 * @param {Array} places - Array of places
	 * @returns {Array} Sorted array of places
	 */
	_sortPlaces(places) {
		return [...places].sort((a, b) => {
			// Sort by section first
			const sectionA = (a.section || '').toLowerCase();
			const sectionB = (b.section || '').toLowerCase();
			if (sectionA !== sectionB) {
				return sectionA.localeCompare(sectionB);
			}

			// Then by row
			const rowA = (a.row || '').toLowerCase();
			const rowB = (b.row || '').toLowerCase();
			if (rowA !== rowB) {
				// Try numeric comparison first
				const rowANum = parseInt(rowA.replace(/\D/g, ''), 10);
				const rowBNum = parseInt(rowB.replace(/\D/g, ''), 10);
				if (!isNaN(rowANum) && !isNaN(rowBNum)) {
					return rowANum - rowBNum;
				}
				return rowA.localeCompare(rowB);
			}

			// Finally by seat
			const seatA = (a.seat || '').toLowerCase();
			const seatB = (b.seat || '').toLowerCase();
			const seatANum = parseInt(seatA.replace(/\D/g, ''), 10);
			const seatBNum = parseInt(seatB.replace(/\D/g, ''), 10);
			if (!isNaN(seatANum) && !isNaN(seatBNum)) {
				return seatANum - seatBNum;
			}
			return seatA.localeCompare(seatB);
		});
	}

	/**
	 * Extract sections metadata from venue or manifest
	 * @private
	 * @param {Object} fullManifest - Full manifest
	 * @returns {Array} Sections array
	 */
	_extractSections(fullManifest) {
		// Try to get sections from venue if populated
		if (fullManifest.venue && typeof fullManifest.venue === 'object' && fullManifest.venue.sections) {
			return fullManifest.venue.sections.map(section => ({
				id: section._id?.toString() || section.id || section.name,
				name: section.name,
				color: section.color || '#2196F3', // Default blue
				bounds: section.bounds || null,
				polygon: section.polygon || null
			}));
		}

		// Fallback: extract sections from places
		const sectionMap = new Map();
		if (fullManifest.places && Array.isArray(fullManifest.places)) {
			for (const place of fullManifest.places) {
				if (place.section && !sectionMap.has(place.section)) {
					sectionMap.set(place.section, {
						id: place.section,
						name: place.section,
						color: '#2196F3', // Default blue
						bounds: null,
						polygon: null
					});
				}
			}
		}

		return Array.from(sectionMap.values());
	}

	/**
	 * Find which partition index a place index belongs to
	 * @private
	 * @param {number} placeIndex - Index in placeIds array
	 * @param {Array<number>} partitions - Partition boundaries
	 * @returns {number} Partition index, or -1 if not found
	 */
	_findPartitionIndex(placeIndex, partitions) {
		if (!partitions || partitions.length === 0) {
			return 0; // All places in first (and only) zone
		}

		// Partitions mark the start of each zone
		// Zone 0: [0, partitions[0])
		// Zone 1: [partitions[0], partitions[1])
		// Zone N: [partitions[N-1], partitions[N])
		// Last zone: [partitions[partitions.length-1], end]

		for (let i = 0; i < partitions.length; i++) {
			if (placeIndex < partitions[i]) {
				return i;
			}
		}

		// Belongs to the last zone
		return partitions.length;
	}

	/**
	 * Generate update hash (MD5 of sorted placeIds) - Ticketmaster format
	 * @private
	 * @param {Array<string>} placeIdsArray - Array of place IDs
	 * @returns {string} 32-character hex hash
	 */
	_generateUpdateHash(placeIdsArray) {
		if (!placeIdsArray || placeIdsArray.length === 0) return null;
		const sorted = [...placeIdsArray].sort();
		return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
	}

	/**
	 * Generate Ticketmaster-style encoded placeIds with pricing tier encoding
	 * Format: VENUE_PREFIX(4) + SECTION_CHAR(1) + TIER_CODE(1) + POSITION_CODE(6-8)
	 * Example: "J4WU" + "A" + "2" + "GE5DCMA" = "J4WUA2GE5DCMA"
	 *
	 * Position code encodes: row, seat, x, y coordinates using hierarchical encoding
	 * Tier code encodes: pricing tier index (0-35, maps to pricing configuration)
	 * @private
	 * @param {Array<Object>} sortedPlaces - Sorted array of place objects with section, row, seat, x, y, pricing
	 * @param {string} venueId - Venue ID (MongoDB ObjectId) for generating consistent prefix
	 * @returns {Object} Object with placeIds array, placeIdMapping, and pricingConfig
	 */
	_generateTicketmasterPlaceIds(sortedPlaces, venueId = null) {
		// Generate a consistent 4-character venue prefix from venueId
		// Same venue = same prefix across all events
		const venuePrefix = this._generateVenuePrefix(venueId);

		// Extract unique pricing configurations and assign tier codes
		const pricingTiers = this._extractPricingTiers(sortedPlaces);
		const tierMapping = {}; // pricing signature -> tier code
		pricingTiers.forEach((tier, index) => {
			tierMapping[tier.signature] = this._numberToBase36(index, 1); // 1-char tier code (0-9, A-Z)
		});

		// Generate encoded placeIds for each place and maintain mapping
		const encodedPlaceIds = [];
		const placeIdMapping = {}; // originalPlaceId -> encodedPlaceId

		sortedPlaces.forEach((place, index) => {
			const originalPlaceId = place.placeId || `PLACE_${index}`;

			// Encode full section name (base64url encoded)
			const section = place.section || '';
			const sectionB64 = this._base64UrlEncode(section);

			// Generate pricing signature for this place
			const pricingSignature = this._generatePricingSignature(place.pricing);
			const tierCode = tierMapping[pricingSignature] || '0'; // Default tier if no pricing

			// Extract position data
			const row = place.row || '';
			const seat = place.seat || '';
			const x = place.x || 0;
			const y = place.y || 0;

			// Encode position: row + seat + x + y using hierarchical encoding
			const positionCode = this._encodePosition(row, seat, x, y);

			// Combine: VENUE_PREFIX + SECTION_B64 + "|" + TIER_CODE + "|" + POSITION_CODE
			const encodedPlaceId = `${venuePrefix}${sectionB64}|${tierCode}|${positionCode}`;

			encodedPlaceIds.push(encodedPlaceId);
			placeIdMapping[originalPlaceId] = encodedPlaceId;
		});

		// Build pricing configuration from tiers
		const pricingConfig = {
			currency: pricingTiers[0]?.pricing?.currency || 'EUR',
			orderFee: pricingTiers[0]?.pricing?.orderFee || 0,
			orderTax: pricingTiers[0]?.pricing?.serviceTax || 0, // Use serviceTax as orderTax
			tiers: pricingTiers.map((tier, index) => ({
				id: this._numberToBase36(index, 1),
				basePrice: tier.pricing?.basePrice || 0,
				tax: tier.pricing?.tax || 0,
				serviceFee: tier.pricing?.serviceFee || 0,
				serviceTax: tier.pricing?.serviceTax || 0
			}))
		};

		return {
			placeIds: encodedPlaceIds,
			placeIdMapping: placeIdMapping,
			pricingConfig: pricingConfig
		};
	}

	/**
	 * Generate a consistent 4-character venue prefix from venueId
	 * Same venue = same prefix across all events (deterministic)
	 * @private
	 * @param {string} venueId - Venue ID (MongoDB ObjectId string)
	 * @returns {string} 4-character prefix (e.g., "J4WU")
	 */
	_generateVenuePrefix(venueId) {
		if (!venueId) {
			// Fallback: generate from timestamp (not ideal, but ensures consistency)
			const hash = crypto.createHash('md5').update(String(Date.now())).digest('hex');
			return this._hexToBase36Prefix(hash, 4);
		}

		// Generate deterministic prefix from venueId
		// Use MD5 hash of venueId, convert to base36, take first 4 characters
		const hash = crypto.createHash('md5').update(String(venueId)).digest('hex');
		return this._hexToBase36Prefix(hash, 4);
	}

	/**
	 * Convert hex string to base36 prefix of specified length
	 * Processes hex in chunks to handle large numbers
	 * @private
	 * @param {string} hex - Hex string
	 * @param {number} length - Desired prefix length
	 * @returns {string} Base36 encoded prefix
	 */
	_hexToBase36Prefix(hex, length) {
		// Process hex in 8-character chunks (32 bits each) to avoid precision loss
		let result = '';
		for (let i = 0; i < hex.length && result.length < length; i += 8) {
			const chunk = hex.substring(i, i + 8);
			const num = parseInt(chunk, 16);
			const base36Chunk = num.toString(36).toUpperCase();
			result += base36Chunk;
		}

		// Take first 'length' characters, pad if needed
		return result.substring(0, length).padEnd(length, '0').toUpperCase();
	}

	/**
	 * Encode position using hierarchical encoding
	 * Combines row, seat, x, y coordinates into a single integer, then converts to base36
	 * Format: (row << 48) | (seat << 32) | (x << 16) | (y)
	 * @private
	 * @param {string|number} row - Row identifier (e.g., "R1" -> 1)
	 * @param {string|number} seat - Seat number (e.g., "1" -> 1)
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @returns {string} Base36 encoded position code (6-8 characters)
	 */
	_encodePosition(row, seat, x, y) {
		// Convert row and seat strings to numbers
		const rowNum = this._stringToNumber(row);
		const seatNum = this._stringToNumber(seat);

		// Ensure coordinates are integers (round to nearest)
		const xInt = Math.round(x);
		const yInt = Math.round(y);

		// Hierarchical encoding: combine all values into single integer
		// JavaScript bitwise operations are limited to 32-bit integers,
		// so we use multiplication instead of bit shifting for large values
		// Format: row * 2^48 + seat * 2^32 + x * 2^16 + y
		// Limit each to 16 bits (0-65535) to prevent overflow
		const row16 = Math.min(rowNum, 65535);
		const seat16 = Math.min(seatNum, 65535);
		const x16 = Math.min(Math.max(xInt, 0), 65535);
		const y16 = Math.min(Math.max(yInt, 0), 65535);

		// Use multiplication for values beyond 32-bit range
		// row: bits 48-63, seat: bits 32-47, x: bits 16-31, y: bits 0-15
		let combinedValue = 0;
		combinedValue += row16 * Math.pow(2, 48);
		combinedValue += seat16 * Math.pow(2, 32);
		combinedValue += x16 * Math.pow(2, 16);
		combinedValue += y16;

		// Convert to base36 (0-9, A-Z)
		// This will produce 6-8 characters for typical values
		return this._numberToBase36(combinedValue, 6);
	}

	/**
	 * Convert number to base36 string (0-9, A-Z)
	 * @private
	 * @param {number} num - Number to convert
	 * @param {number} minLength - Minimum length (padded with leading zeros)
	 * @returns {string} Base36 encoded string
	 */
	_numberToBase36(num, minLength = 0) {
		if (typeof num === 'string') {
			// Try to parse as number first
			const parsed = parseInt(num, 10);
			if (!isNaN(parsed)) {
				num = parsed;
			} else {
				// Convert string to number using char codes
				num = this._stringToNumber(num);
			}
		}

		const base36 = num.toString(36).toUpperCase();
		return base36.padStart(minLength, '0');
	}

	/**
	 * Convert string to number (for encoding)
	 * @private
	 * @param {string} str - String to convert
	 * @returns {number} Numeric representation
	 */
	_stringToNumber(str) {
		if (typeof str === 'number') return str;
		if (!str) return 0;

		// Remove non-numeric prefix (e.g., "R1" -> 1, "A1" -> 1)
		const numericPart = str.replace(/[^0-9]/g, '');
		if (numericPart) {
			return parseInt(numericPart, 10);
		}

		// If no numeric part, use sum of char codes
		let sum = 0;
		for (let i = 0; i < str.length; i++) {
			sum += str.charCodeAt(i);
		}
		return sum;
	}

	/**
	 * Extract unique pricing configurations (tiers) from places
	 * @private
	 * @param {Array<Object>} places - Array of place objects with pricing
	 * @returns {Array<Object>} Array of unique pricing tiers with signatures
	 */
	_extractPricingTiers(places) {
		const tierMap = new Map();

		places.forEach(place => {
			if (place.pricing) {
				const signature = this._generatePricingSignature(place.pricing);
				if (!tierMap.has(signature)) {
					tierMap.set(signature, {
						signature,
						pricing: place.pricing
					});
				}
			}
		});

		return Array.from(tierMap.values());
	}

	/**
	 * Generate a signature for pricing configuration (for deduplication)
	 * @private
	 * @param {Object} pricing - Pricing configuration object
	 * @returns {string} Signature string
	 */
	_generatePricingSignature(pricing) {
		if (!pricing) return 'none';

		// Create a signature from key pricing fields
		const key = `${pricing.basePrice || 0}_${pricing.tax || 0}_${pricing.serviceFee || 0}_${pricing.serviceTax || 0}_${pricing.currency || 'EUR'}`;
		return key;
	}
}

// Export singleton instance
export const manifestEncoderService = new ManifestEncoderService();
export default manifestEncoderService;

