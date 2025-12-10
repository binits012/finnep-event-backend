import crypto from 'crypto'
import * as seatmapAlgorithms from './seatmapAlgorithms.js'

/**
 * Generate a manifest structure similar to Ticketmaster format
 * Creates a manifest with eventId, updateHash, updateTime, and placeIds array
 * @param {Object} config - Manifest generation configuration
 * @param {string} config.eventId - Event identifier (format: "FI-XXXXXXXX" or custom)
 * @param {Array<string>} config.placeIds - Array of place/seat identifiers
 * @param {number} config.updateTime - Optional timestamp (defaults to current time)
 * @returns {Object} Manifest in Ticketmaster-like format
 */
export const generateManifest = (config) => {
	const { eventId, placeIds = [], updateTime } = config

	// eventId is optional - generate one if not provided
	const finalEventId = eventId || `MANIFEST-${Date.now()}`

	if (!placeIds || placeIds.length === 0) {
		throw new Error('placeIds array is required and cannot be empty')
	}

	// Generate updateHash (MD5 of sorted placeIds)
	const updateHash = generateUpdateHash(placeIds)

	// Use provided updateTime or current timestamp
	const manifestUpdateTime = updateTime || Date.now()

	return {
		eventId: finalEventId,
		updateHash: updateHash,
		updateTime: manifestUpdateTime,
		placeIds: [...placeIds] // Return copy of array
	}
}

/**
 * Generate placeIds based on pattern and configuration
 * Useful for creating manifests programmatically
 * @param {Object} config - Place generation configuration
 * @param {string} config.prefix - Prefix for placeIds (e.g., "J4WUCTZ2GE")
 * @param {number} config.count - Number of places to generate
 * @param {string} config.pattern - Generation pattern ('sequential', 'grid', 'custom')
 * @param {Object} config.patternConfig - Pattern-specific configuration
 * @returns {Array<string>} Array of generated placeIds
 */
export const generatePlaceIds = (config) => {
	const { prefix = '', count = 100, pattern = 'sequential', patternConfig = {} } = config

	console.log(`[generatePlaceIds] Called with count=${count}, pattern=${pattern}, prefix="${prefix}"`)

	const placeIds = []

	if (pattern === 'sequential') {
		// Generate sequential placeIds: prefix + sequential suffix
		for (let i = 0; i < count; i++) {
			// Generate suffix (similar to Ticketmaster encoding)
			const suffix = generatePlaceIdSuffix(i, patternConfig)
			placeIds.push(`${prefix}${suffix}`)
		}
	} else if (pattern === 'grid') {
		// Generate grid-based placeIds (section-row-seat pattern)
		// If patternConfig has sections/rowsPerSection/seatsPerRow, use them as initial structure
		// But always generate exactly 'count' number of placeIds by expanding the grid as needed
		const { sections = 1, rowsPerSection = 10, seatsPerRow = 20 } = patternConfig
		let index = 0
		let section = 0
		let row = 0
		let seat = 0

		// Generate exactly 'count' placeIds
		// When grid wraps, expand it by incrementing rows/sections instead of wrapping
		while (index < count) {
			const suffix = generatePlaceIdSuffix(index, { section, row, seat })
			placeIds.push(`${prefix}${suffix}`)
			index++

			// Increment grid coordinates for next placeId
			seat++
			if (seat >= seatsPerRow) {
				seat = 0
				row++
				// If we exceed rowsPerSection, expand to next section instead of wrapping
				if (row >= rowsPerSection) {
					row = 0
					section++
					// If we exceed sections, continue expanding sections (don't wrap)
					// This ensures unique placeIds even beyond the initial grid configuration
				}
			}
		}
	} else if (pattern === 'custom' && patternConfig.generator) {
		// Use custom generator function
		for (let i = 0; i < count; i++) {
			placeIds.push(patternConfig.generator(i, patternConfig))
		}
	}

	return placeIds
}

/**
 * Generate placeId suffix using base36 encoding (similar to Ticketmaster)
 * @param {number} index - Index number
 * @param {Object} config - Optional configuration for encoding
 * @returns {string} Encoded suffix
 */
const generatePlaceIdSuffix = (index, config = {}) => {
	if (config.section !== undefined && config.row !== undefined && config.seat !== undefined) {
		// Multi-dimensional encoding
		const sectionCode = indexToBase36(config.section)
		const rowCode = indexToBase36(config.row)
		const seatCode = indexToBase36(config.seat)
		return `${sectionCode}${rowCode}${seatCode}`
	}

	// Simple sequential encoding
	return indexToBase36(index)
}

/**
 * Convert number to base36 string (0-9, A-Z)
 * @param {number} num - Number to convert
 * @returns {string} Base36 encoded string
 */
const indexToBase36 = (num) => {
	return num.toString(36).toUpperCase().padStart(2, '0')
}

/**
 * Generate update hash (MD5 of sorted placeIds)
 * @param {Array<string>} placeIdsArray - Array of place IDs
 * @returns {string} 32-character hex hash
 */
export const generateUpdateHash = (placeIdsArray) => {
	if (!placeIdsArray || placeIdsArray.length === 0) return null
	const sorted = [...placeIdsArray].sort()
	return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex')
}

// Re-export for use in controller
export { generateUpdateHash as generateUpdateHashUtil }

/**
 * Convert manifest structure (with placeIds array) to our schema format
 * Takes a manifest-like structure and converts it to our internal format
 * @param {Object} manifestData - Manifest data with placeIds array
 * @param {string} venueId - MongoDB venue ID
 * @returns {Object} Normalized manifest data for our schema
 */
export const normalizeManifestData = (manifestData, venueId) => {
	if (!manifestData || !manifestData.placeIds) {
		throw new Error('Invalid manifest data: placeIds array is required')
	}

	// Convert placeIds array to places array with basic structure
	const places = manifestData.placeIds.map((placeId, index) => {
		const parsed = seatmapAlgorithms.parsePlaceId(placeId)
		return {
			placeId: placeId,
			section: parsed.section,
			row: parsed.row,
			seat: parsed.seat,
			pricing: {
				basePrice: 0, // Will be set later or from pricing data
				currency: 'EUR',
				currentPrice: 0
			},
			available: true,
			status: 'available',
			metadata: {
				source: 'generated',
				originalIndex: index
			}
		}
	})

	return {
		venue: venueId,
		name: manifestData.name || `Manifest for ${manifestData.eventId || 'Venue'}`,
		updateHash: manifestData.updateHash,
		updateTime: manifestData.updateTime,
		places: places,
		coordinateSource: 'pattern_inference', // Will be updated if coordinates are provided
		layoutAlgorithm: null, // Will be determined later
		...(manifestData.eventId && { externalEventId: manifestData.eventId }) // Only include if provided
	}
}

/**
 * Compare two manifests to detect changes
 * @param {Object} oldManifest - Previous manifest (can be our schema or Ticketmaster format)
 * @param {Object} newManifest - New manifest (can be our schema or Ticketmaster format)
 * @returns {Object} Comparison result
 */
export const compareManifests = (oldManifest, newManifest) => {
	if (!oldManifest || !newManifest) {
		return { changed: true, reason: 'Missing manifest data' }
	}

	// Compare updateHash (fastest method)
	if (oldManifest.updateHash === newManifest.updateHash) {
		return { changed: false }
	}

	// Handle both formats: placeIds array or places array
	const oldPlaceIds = oldManifest.placeIds
		? [...oldManifest.placeIds].sort()
		: (oldManifest.places || []).map(p => p.placeId).sort()

	const newPlaceIds = newManifest.placeIds
		? [...newManifest.placeIds].sort()
		: (newManifest.places || []).map(p => p.placeId).sort()

	const added = newPlaceIds.filter(id => !oldPlaceIds.includes(id))
	const removed = oldPlaceIds.filter(id => !newPlaceIds.includes(id))

	return {
		changed: true,
		added: added,
		removed: removed,
		modified: [] // Would need deeper comparison for modified places
	}
}

/**
 * Validate manifest structure (Ticketmaster-like format)
 * @param {Object} data - Manifest data to validate
 * @returns {Object} Validation result with errors array
 */
export const validateManifestStructure = (data) => {
	const errors = []

	// eventId is optional - will be auto-generated if not provided

	// placeIds array is required for Ticketmaster format
	if (!data.placeIds || !Array.isArray(data.placeIds) || data.placeIds.length === 0) {
		errors.push('placeIds array is required and cannot be empty')
	}

	if (data.updateHash && typeof data.updateHash !== 'string') {
		errors.push('updateHash must be a string')
	}

	if (data.updateTime && typeof data.updateTime !== 'number') {
		errors.push('updateTime must be a number')
	}

	return {
		valid: errors.length === 0,
		errors: errors
	}
}

/**
 * Create a manifest from scratch with generated placeIds
 * @param {Object} config - Configuration for manifest generation
 * @param {string} config.eventId - Event identifier
 * @param {string} config.venueId - MongoDB venue ID
 * @param {Object} config.placeGeneration - Configuration for generating placeIds
 * @param {number} config.totalPlaces - Total number of places to generate
 * @returns {Object} Complete manifest ready to save
 */
export const createManifestFromScratch = (config) => {
	const { eventId, venueId, placeGeneration = {}, totalPlaces = 100 } = config

	// Generate placeIds
	const placeIds = generatePlaceIds({
		prefix: placeGeneration.prefix || '',
		count: totalPlaces,
		pattern: placeGeneration.pattern || 'sequential',
		patternConfig: placeGeneration.patternConfig || {}
	})

	// Generate manifest structure
	const manifestStructure = generateManifest({
		eventId,
		placeIds
	})

	// Normalize to our schema format
	return normalizeManifestData(manifestStructure, venueId)
}


