/**
 * Seatmap Algorithms for coordinate inference and layout generation
 */

/**
 * Pattern Recognition - Analyze placeId patterns
 * @param {string} placeId - Place identifier (e.g., "J4WUCTZ2GE5DC")
 * @returns {Object} Extracted information
 */
export const parsePlaceId = (placeId) => {
	if (!placeId || typeof placeId !== 'string') {
		return { section: null, row: null, seat: null }
	}

	// Common patterns in Ticketmaster placeIds
	// Example: "J4WUCTZ2GE5DC" might encode section/row/seat info
	// This is a basic implementation - can be enhanced based on actual patterns

	const length = placeId.length

	// Try to extract section from prefix (first N characters)
	// Try to extract row/seat from suffix or middle
	let section = null
	let row = null
	let seat = null

	// Pattern 1: If placeId has consistent structure, extract by position
	if (length >= 10) {
		// Assume first 6-8 chars might be section identifier
		section = placeId.substring(0, Math.min(8, Math.floor(length * 0.6)))

		// Last few characters might be seat identifier
		const remaining = placeId.substring(section.length)
		if (remaining.length >= 2) {
			seat = remaining
		}
	}

	// Pattern 2: Group by common prefixes (for section detection)
	// This would be done at a higher level when processing multiple placeIds

	return {
		section: section || 'UNKNOWN',
		row: row || null,
		seat: seat || placeId,
		original: placeId
	}
}

/**
 * Section Detection - Group placeIds by common prefixes and price tiers
 * @param {Array<Object>} places - Array of place objects
 * @returns {Object} Section groups
 */
export const detectSections = (places) => {
	if (!places || places.length === 0) {
		return {}
	}

	const sections = {}

	places.forEach(place => {
		const parsed = parsePlaceId(place.placeId)
		const sectionName = parsed.section || 'DEFAULT'

		if (!sections[sectionName]) {
			sections[sectionName] = {
				name: sectionName,
				places: [],
				priceRange: { min: Infinity, max: -Infinity },
				count: 0
			}
		}

		sections[sectionName].places.push(place)
		sections[sectionName].count++

		const price = place.pricing?.basePrice || place.pricing?.currentPrice || 0
		if (price > 0) {
			sections[sectionName].priceRange.min = Math.min(sections[sectionName].priceRange.min, price)
			sections[sectionName].priceRange.max = Math.max(sections[sectionName].priceRange.max, price)
		}
	})

	// Clean up price ranges
	Object.keys(sections).forEach(sectionName => {
		if (sections[sectionName].priceRange.min === Infinity) {
			sections[sectionName].priceRange = { min: 0, max: 0 }
		}
	})

	return sections
}

/**
 * Grid Layout Algorithm (Stadium/Arena)
 * @param {Object} config - Layout configuration
 * @param {number} config.totalSeats - Total number of seats
 * @param {number} config.sections - Number of sections
 * @param {number} config.seatsPerRow - Average seats per row
 * @param {number} config.sectionWidth - Width of each section
 * @param {number} config.seatSpacing - Horizontal spacing between seats
 * @param {number} config.rowSpacing - Vertical spacing between rows
 * @param {Object} config.sectionNaming - Section naming configuration
 * @param {string} config.sectionNaming.pattern - 'numeric', 'alphabetic', 'alphanumeric', 'custom'
 * @param {Array<string>} config.sectionNaming.customNames - Custom section names array
 * @param {Array<string>} placeIds - Array of place IDs
 * @returns {Array<Object>} Places with coordinates
 */
export const generateGridLayout = (config, placeIds) => {
	const {
		totalSeats,
		sections = 1,
		seatsPerRow = 20,
		sectionWidth = 100,
		seatSpacing = 2,
		rowSpacing = 3,
		sectionNaming = { pattern: 'numeric' }
	} = config

	if (!placeIds || placeIds.length === 0) {
		return []
	}

	const rowsPerSection = Math.ceil((totalSeats / sections) / seatsPerRow)
	const places = []

	// Helper function to generate section name
	const getSectionName = (sectionIndex) => {
		const { pattern = 'numeric', customNames = [] } = sectionNaming

		if (pattern === 'custom' && customNames.length > 0) {
			// Use custom names, cycle if more sections than names
			return customNames[sectionIndex % customNames.length] || `Section ${sectionIndex + 1}`
		}

		if (pattern === 'alphabetic') {
			// A, B, C, ..., Z, AA, AB, ...
			let result = ''
			let num = sectionIndex
			do {
				result = String.fromCharCode(65 + (num % 26)) + result
				num = Math.floor(num / 26) - 1
			} while (num >= 0)
			return result
		}

		if (pattern === 'alphanumeric') {
			// A1, A2, B1, B2, ...
			const letter = String.fromCharCode(65 + Math.floor(sectionIndex / 10))
			const number = (sectionIndex % 10) + 1
			return `${letter}${number}`
		}

		// Default: numeric
		return `Section ${sectionIndex + 1}`
	}

	placeIds.forEach((placeId, seatIndex) => {
		const sectionIndex = Math.floor(seatIndex / (rowsPerSection * seatsPerRow))
		const seatInSection = seatIndex % (rowsPerSection * seatsPerRow)
		const rowInSection = Math.floor(seatInSection / seatsPerRow)
		const seatInRow = seatInSection % seatsPerRow

		const x = sectionIndex * sectionWidth + seatInRow * seatSpacing
		const y = rowInSection * rowSpacing

		places.push({
			placeId,
			x,
			y,
			row: `R${rowInSection + 1}`,
			seat: `${seatInRow + 1}`,
			section: getSectionName(sectionIndex)
		})
	})

	return places
}

/**
 * Curved Theater Layout Algorithm
 * @param {Object} config - Layout configuration
 * @param {number} config.centerX - Center X coordinate
 * @param {number} config.centerY - Center Y coordinate
 * @param {number} config.baseRadius - Radius of first row
 * @param {number} config.rowSpacing - Distance between rows
 * @param {number} config.seatsPerRow - Number of seats in each row
 * @param {number} config.totalRows - Total number of rows
 * @param {Array<string>} placeIds - Array of place IDs
 * @returns {Array<Object>} Places with coordinates
 */
export const generateCurvedLayout = (config, placeIds) => {
	const {
		centerX = 500,
		centerY = 500,
		baseRadius = 100,
		rowSpacing = 20,
		seatsPerRow = 30,
		totalRows = 20
	} = config

	if (!placeIds || placeIds.length === 0) {
		return []
	}

	const places = []

	placeIds.forEach((placeId, seatIndex) => {
		const rowIndex = Math.floor(seatIndex / seatsPerRow)
		const seatInRow = seatIndex % seatsPerRow

		if (rowIndex >= totalRows) {
			// Skip if exceeds total rows
			return
		}

		const radius = baseRadius + (rowIndex * rowSpacing)
		const angle = (seatInRow / seatsPerRow) * 2 * Math.PI - Math.PI // -π to π range

		const x = centerX + radius * Math.cos(angle)
		const y = centerY + radius * Math.sin(angle)

		places.push({
			placeId,
			x,
			y,
			row: `R${rowIndex + 1}`,
			seat: `${seatInRow + 1}`,
			section: 'Main'
		})
	})

	return places
}

/**
 * General Admission Layout (Zone-based)
 * @param {Object} config - Layout configuration
 * @param {number} config.capacity - Total capacity
 * @param {Array<Object>} config.zones - Zone definitions with boundaries
 * @param {Array<string>} placeIds - Array of place IDs (optional for GA)
 * @returns {Array<Object>} Zone boundaries (no individual seats)
 */
export const generateGeneralAdmissionLayout = (config, placeIds = []) => {
	const {
		capacity = 1000,
		zones = []
	} = config

	// For general admission, we return zone boundaries
	// Individual placeIds are not assigned to specific coordinates
	return zones.map((zone, index) => ({
		zoneId: zone.id || `Zone${index + 1}`,
		name: zone.name || `Zone ${index + 1}`,
		bounds: zone.bounds || { x1: 0, y1: 0, x2: 100, y2: 100 },
		capacity: zone.capacity || Math.floor(capacity / zones.length),
		places: [] // GA doesn't have individual seat assignments
	}))
}

/**
 * Coordinate Normalization
 * Normalize coordinates to 0-1000 scale for consistent rendering
 * @param {Array<Object>} places - Places with raw coordinates
 * @returns {Array<Object>} Places with normalized coordinates
 */
export const normalizeCoordinates = (places) => {
	if (!places || places.length === 0) {
		return []
	}

	// Find min/max coordinates
	let minX = Infinity, maxX = -Infinity
	let minY = Infinity, maxY = -Infinity

	places.forEach(place => {
		if (place.x !== undefined && place.x !== null) {
			minX = Math.min(minX, place.x)
			maxX = Math.max(maxX, place.x)
		}
		if (place.y !== undefined && place.y !== null) {
			minY = Math.min(minY, place.y)
			maxY = Math.max(maxY, place.y)
		}
	})

	// If all coordinates are the same or invalid, return as-is
	if (minX === Infinity || minX === maxX) {
		return places.map(p => ({ ...p, normalizedX: p.x || 0, normalizedY: p.y || 0 }))
	}
	if (minY === maxY) {
		return places.map(p => ({ ...p, normalizedX: p.x || 0, normalizedY: p.y || 0 }))
	}

	// Normalize to 0-1000 scale
	const normalizedPlaces = places.map(place => {
		const normalizedX = place.x !== undefined && place.x !== null
			? ((place.x - minX) / (maxX - minX)) * 1000
			: 0
		const normalizedY = place.y !== undefined && place.y !== null
			? ((place.y - minY) / (maxY - minY)) * 1000
			: 0

		return {
			...place,
			normalizedX,
			normalizedY
		}
	})

	return normalizedPlaces
}

/**
 * Group places by section
 * @param {Array<Object>} places - Array of place objects with section information
 * @returns {Object} Sections object with section names as keys
 */
export const groupPlacesBySection = (places) => {
	if (!places || places.length === 0) {
		return {}
	}

	const sections = {}

	places.forEach(place => {
		const sectionName = place.section || 'DEFAULT'

		if (!sections[sectionName]) {
			sections[sectionName] = {
				name: sectionName,
				places: [],
				count: 0
			}
		}

		sections[sectionName].places.push(place)
		sections[sectionName].count++
	})

	return sections
}

