/**
 * Manual Section Layout Algorithm
 * Generates seat coordinates based on manually configured sections
 * Supports both rectangle and polygon section shapes
 */

/**
 * Generate seats within manually configured sections
 * @param {Object} config - Configuration
 * @param {Array<Object>} config.sections - Manually configured sections from venue
 * @param {Array<string>} placeIds - Array of place IDs to assign
 * @param {Object} config.layoutConfig - Layout configuration (seatSpacing, rowSpacing)
 * @returns {Array<Object>} Places with coordinates assigned to sections
 */
export const generateManualSectionLayout = (config, placeIds) => {
	const { sections = [], layoutConfig = {} } = config
	const { seatSpacing = 2, rowSpacing = 3 } = layoutConfig

	if (!sections || sections.length === 0) {
		throw new Error('No sections configured. Please configure sections first.')
	}

	if (!placeIds || placeIds.length === 0) {
		return []
	}

	const places = []
	let placeIndex = 0

	// Calculate total capacity
	// If rowConfig exists, calculate from rowConfig; otherwise use capacity or rows*seatsPerRow
	const totalCapacity = sections.reduce((sum, section) => {
		if (section.capacity) {
			return sum + section.capacity
		}
		// If rowConfig exists, sum up seatCount from all rows
		if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
			const rowConfigCapacity = section.rowConfig.reduce((rowSum, row) => {
				return rowSum + (row.seatCount || 0)
			}, 0)
			console.log(`[generateManualSectionLayout] Section ${section.name}: rowConfig capacity = ${rowConfigCapacity}`)
			return sum + rowConfigCapacity
		}
		// Fallback to rows * seatsPerRow
		return sum + ((section.rows || 0) * (section.seatsPerRow || 0))
	}, 0)

	console.log(`[generateManualSectionLayout] Total capacity: ${totalCapacity}, Total placeIds: ${placeIds.length}`)

	// Distribute placeIds across sections based on capacity
	sections.forEach((section) => {
		// Calculate section capacity: use explicit capacity, or calculate from rowConfig, or fallback to rows*seatsPerRow
		let sectionCapacity = section.capacity
		if (!sectionCapacity) {
			if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
				// Calculate from rowConfig
				sectionCapacity = section.rowConfig.reduce((sum, row) => {
					return sum + (row.seatCount || 0)
				}, 0)
			} else {
				// Fallback to rows * seatsPerRow
				sectionCapacity = (section.rows || 0) * (section.seatsPerRow || 0)
			}
		}
		if (sectionCapacity === 0) return

		// For manual sections with rowConfig, use ALL placeIds needed (don't distribute)
		// This ensures each section gets exactly the seats it needs based on its rowConfig
		let sectionPlaceIds
		if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
			// Use exact capacity from rowConfig
			// Ensure we don't exceed available placeIds
			const availablePlaceIds = placeIds.length - placeIndex
			const requestedCapacity = sectionCapacity
			const actualCapacity = Math.min(requestedCapacity, availablePlaceIds)

			console.log(`[generateManualSectionLayout] Section ${section.name}: Requested ${requestedCapacity} seats, available ${availablePlaceIds} placeIds, allocating ${actualCapacity}`)

			sectionPlaceIds = placeIds.slice(placeIndex, placeIndex + actualCapacity)
			placeIndex += actualCapacity
		} else {
			// For sections without rowConfig, distribute proportionally
			const seatsForSection = Math.floor((sectionCapacity / totalCapacity) * placeIds.length)
			sectionPlaceIds = placeIds.slice(placeIndex, placeIndex + seatsForSection)
			placeIndex += seatsForSection
		}

		// Generate seats within this section
		const sectionSeats = generateSeatsInSection(section, sectionPlaceIds, {
			seatSpacing,
			rowSpacing
		})

		places.push(...sectionSeats)
	})

	// Assign remaining placeIds to the last section or distribute evenly
	if (placeIndex < placeIds.length) {
		const remainingPlaceIds = placeIds.slice(placeIndex)
		const lastSection = sections[sections.length - 1]
		if (lastSection) {
			const additionalSeats = generateSeatsInSection(
				lastSection,
				remainingPlaceIds,
				{ seatSpacing, rowSpacing },
				places.length // Offset for existing seats
			)
			places.push(...additionalSeats)
		}
	}

	return places
}

/**
 * Generate seats within a single section
 * @param {Object} section - Section configuration
 * @param {Array<string>} placeIds - Place IDs for this section
 * @param {Object} spacing - Spacing configuration
 * @param {number} seatOffset - Offset for seat numbering
 * @returns {Array<Object>} Places with coordinates
 */
const generateSeatsInSection = (section, placeIds, spacing, seatOffset = 0) => {
	const { seatSpacing = 2, rowSpacing = 3 } = spacing
	const places = []

	if (section.shape === 'polygon' && section.polygon && section.polygon.length > 0) {
		// Polygon section - check if rowConfig is provided (variable row configuration)
		if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
			console.log(`[generateSeatsInSection] Using rowConfig for polygon section: ${section.name}, rows: ${section.rowConfig.length}`)
			return generateSeatsInPolygonWithRowConfig(section, placeIds, spacing, seatOffset)
		}
		// Polygon section - use bounding box and distribute seats uniformly
		console.log(`[generateSeatsInSection] Using uniform grid for polygon section: ${section.name}`)
		return generateSeatsInPolygon(section, placeIds, spacing, seatOffset)
	}

	// Rectangle section
	const bounds = section.bounds || {}
	const x1 = bounds.x1 || 0
	const y1 = bounds.y1 || 0
	const x2 = bounds.x2 || 100
	const y2 = bounds.y2 || 100

	const sectionWidth = x2 - x1
	const sectionHeight = y2 - y1

	// Check if rowConfig is provided (variable row configuration)
	if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
		return generateSeatsWithRowConfig(section, placeIds, spacing, bounds)
	}

	// Use configured rows/seatsPerRow or calculate (uniform rows)
	const rows = section.rows || Math.ceil(Math.sqrt(placeIds.length / (section.seatsPerRow || 20)))
	const seatsPerRow = section.seatsPerRow || Math.ceil(placeIds.length / rows)

	// Calculate spacing to fit within section bounds
	const availableWidth = sectionWidth - (seatSpacing * 2)
	const availableHeight = sectionHeight - (rowSpacing * 2)
	const calculatedSeatSpacing = availableWidth / Math.max(seatsPerRow - 1, 1)
	const calculatedRowSpacing = availableHeight / Math.max(rows - 1, 1)

	let placeIndex = 0
	let seatNumber = 0
	for (let rowIndex = 0; rowIndex < rows && placeIndex < placeIds.length; rowIndex++) {
		for (let seatInRow = 0; seatInRow < seatsPerRow && placeIndex < placeIds.length; seatInRow++) {
			const x = x1 + seatSpacing + (seatInRow * calculatedSeatSpacing)
			const y = y1 + rowSpacing + (rowIndex * calculatedRowSpacing)

			// Check if this position is within an obstruction
			if (!isPointInObstruction({ x, y }, section.obstructions || [])) {
				const placeId = placeIds[placeIndex]
				seatNumber++
				places.push({
					placeId,
					x,
					y,
					row: `R${rowIndex + 1}`,
					seat: `${seatNumber}`,
					section: section.name || 'Unknown',
					zone: section.priceTier || null
				})
				placeIndex++
			}
			// If in obstruction, skip this position (don't place a seat here)
		}
	}

	return places
}

/**
 * Generate seats using rowConfig (variable row configuration)
 * Each row can have different number of seats, aisles, and offsets
 */
const generateSeatsWithRowConfig = (section, placeIds, spacing, bounds) => {
	const { seatSpacing = 2, rowSpacing = 3 } = spacing
	const places = []
	const x1 = bounds.x1 || 0
	const y1 = bounds.y1 || 0
	const x2 = bounds.x2 || 100
	const y2 = bounds.y2 || 100

	const sectionWidth = x2 - x1
	const sectionHeight = y2 - y1

	// Sort rowConfig by rowNumber
	const sortedRows = [...(section.rowConfig || [])].sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0))
	const totalRows = sortedRows.length

	// DEBUG: Log raw rowConfig data before processing
	console.log(`[generateSeatsWithRowConfig] RAW rowConfig data for section "${section.name}":`)
	sortedRows.forEach((r, i) => {
		console.log(`  Row ${i}: rowNumber=${r.rowNumber}, rowLabel=${r.rowLabel}, offsetY=${r.offsetY} (type: ${typeof r.offsetY})`)
	})

	// CRITICAL FIX: Calculate consistent seat spacing based on the WIDEST row
	// This ensures all seats align vertically across rows
	const maxSeatsInRow = Math.max(...sortedRows.map(row => {
		const seatCount = row.seatCount || section.seatsPerRow || 20
		const aisleLeft = row.aisleLeft || 0
		const aisleRight = row.aisleRight || 0
		return seatCount + aisleLeft + aisleRight
	}))

	// Get spacing configuration from section (with defaults)
	const spacingConfig = section.spacingConfig || {}
	const configTopPadding = spacingConfig.topPadding !== undefined ? spacingConfig.topPadding : 40
	const configSeatSpacingMultiplier = spacingConfig.seatSpacingMultiplier !== undefined ? spacingConfig.seatSpacingMultiplier :
		(presentationStyle === 'cone' ? 0.75 : 0.65) // More generous spacing for cone
	const configRowSpacingMultiplier = spacingConfig.rowSpacingMultiplier !== undefined ? spacingConfig.rowSpacingMultiplier : 0.75
	const configCurveDepthMultiplier = spacingConfig.curveDepthMultiplier !== undefined ? spacingConfig.curveDepthMultiplier : 0.7

	// Fixed seat spacing based on the widest row
	// This ensures vertical alignment across all rows
	// Reduce marginX when using very small multipliers to allow tighter spacing
	const marginX = configSeatSpacingMultiplier < 0.3 ? 5 : (seatSpacing > 1 ? seatSpacing : 20)
	const availableWidth = sectionWidth - (marginX * 2)
	// Use section-specific seat spacing multiplier
	// IMPORTANT: Clamp multiplier to max 1.0 to ensure seats don't exceed section bounds
	// Allow very small multipliers (0.01 - 1.0) for tight spacing
	const clampedSeatSpacingMultiplier = Math.max(0.01, Math.min(1.0, configSeatSpacingMultiplier))
	const fixedSeatSpacing = maxSeatsInRow > 1 ? (availableWidth / (maxSeatsInRow - 1)) * clampedSeatSpacingMultiplier : availableWidth * clampedSeatSpacingMultiplier

	console.log(`[generateSeatsWithRowConfig] Seat spacing calculation: availableWidth=${availableWidth.toFixed(2)}, maxSeatsInRow=${maxSeatsInRow}, multiplier=${clampedSeatSpacingMultiplier}, fixedSeatSpacing=${fixedSeatSpacing.toFixed(2)}`)

	// Calculate row spacing with section-specific top padding
	const topPadding = configTopPadding
	// Use section-specific row spacing multiplier
	// IMPORTANT: Clamp multiplier to max 1.0 to ensure rows don't exceed section bounds
	const clampedRowSpacingMultiplier = Math.min(1.0, configRowSpacingMultiplier)
	const calculatedRowSpacing = totalRows > 1 ? ((sectionHeight - topPadding - (rowSpacing * 2)) / (totalRows - 1)) * clampedRowSpacingMultiplier : 0

	// Get presentation style from section configuration
	const presentationStyle = section.presentationStyle || 'flat'

	// Check if any row has manual Y offsets - if so, use offset-based positioning instead of calculated spacing
	const hasManualYOffsets = sortedRows.some(row => row.offsetY && row.offsetY !== 0)

	// Debug: Log all row offsets to verify they're being read correctly
	console.log(`[generateSeatsWithRowConfig] Section: ${section.name}`)
	console.log(`[generateSeatsWithRowConfig] hasManualYOffsets: ${hasManualYOffsets}`)
	console.log(`[generateSeatsWithRowConfig] Row offsets:`, sortedRows.map((r, i) => ({
		index: i,
		rowNumber: r.rowNumber,
		rowLabel: r.rowLabel,
		offsetY: r.offsetY,
		offsetYType: typeof r.offsetY
	})))
	console.log(`[generateSeatsWithRowConfig] Calculated row spacing: ${calculatedRowSpacing.toFixed(2)}`)

	let placeIndex = 0

	sortedRows.forEach((rowConfig, rowArrayIndex) => {
		const rowNumber = rowConfig.rowNumber || (rowArrayIndex + 1)
		const rowLabel = rowConfig.rowLabel || `R${rowNumber}`
		const seatCount = rowConfig.seatCount || section.seatsPerRow || 20
		const startSeatNumber = rowConfig.startSeatNumber || 1
		const aisleLeft = rowConfig.aisleLeft || 0
		const aisleRight = rowConfig.aisleRight || 0
		const offsetX = rowConfig.offsetX || 0
		// Ensure offsetY is a number, handle string conversion
		const offsetY = typeof rowConfig.offsetY === 'string' ? parseFloat(rowConfig.offsetY) || 0 : (rowConfig.offsetY || 0)

		// Calculate base Y position for this row
		// If manual Y offsets are used, ignore calculated spacing and use offsets as spacing from previous row
		// Otherwise, use calculated spacing with optional offset for fine-tuning
		let baseY
		if (hasManualYOffsets) {
			// Manual offset mode: offsetY represents spacing from the PREVIOUS row
			// First row starts at topPadding + its own offsetY
			// Each subsequent row is positioned at: previous row's Y + current row's offsetY
			if (rowArrayIndex === 0) {
				baseY = y1 + configTopPadding + offsetY
			} else {
				// Calculate previous row's baseY by iterating through all previous rows
				let prevBaseY = y1 + configTopPadding
				for (let i = 0; i < rowArrayIndex; i++) {
					const prevOffsetY = typeof sortedRows[i].offsetY === 'string' ? parseFloat(sortedRows[i].offsetY) || 0 : (sortedRows[i].offsetY || 0)
					prevBaseY += prevOffsetY
				}
				// Current row's position = previous row's position + current row's offsetY
				baseY = prevBaseY + offsetY
			}
			console.log(`[Row ${rowLabel}] Manual offset mode: rowArrayIndex=${rowArrayIndex}, offsetY=${offsetY}, baseY=${baseY.toFixed(2)}, y1=${y1.toFixed(2)}, topPadding=${configTopPadding}`)
		} else {
			// Automatic spacing mode: Use calculated spacing with optional fine-tuning offset
			baseY = y1 + configTopPadding + rowSpacing + (rowArrayIndex * calculatedRowSpacing) + offsetY
			console.log(`[Row ${rowLabel}] Auto spacing mode: rowArrayIndex=${rowArrayIndex}, calculatedRowSpacing=${calculatedRowSpacing.toFixed(2)}, offsetY=${offsetY}, baseY=${baseY.toFixed(2)}`)
		}

		// Calculate total positions needed (seats + aisles)
		const totalPositions = seatCount + aisleLeft + aisleRight

		// Calculate row width based on fixed spacing
		const rowWidth = totalPositions > 1 ? (totalPositions - 1) * fixedSeatSpacing : 0

		// Calculate row start X based on presentation style
		let rowStartX
		// Curve depth for cone/fan patterns (as percentage of row spacing)
		let curveDepth = 0

		if (presentationStyle === 'flat') {
			// Flat: Center each row individually for perfect vertical alignment
			const sectionCenterX = (x1 + x2) / 2
			rowStartX = sectionCenterX - (rowWidth / 2)
			curveDepth = 0 // No curve for flat

		} else if (presentationStyle === 'cone') {
			// Cone: Use a fixed centered grid based on maxSeatsInRow
			// Each row is centered within this grid, creating a symmetric fan effect
			// Rows with the same seat count will align vertically
			//
			// Example with maxSeatsInRow = 15:
			//   Grid centered at section center, width = 14 * spacing
			//   Row 1 (15 seats): centered, uses positions 0-14
			//   Row 4 (14 seats): centered, uses positions 0.5-13.5 (centered within grid)
			//   Row 9 (9 seats): centered, uses positions 3-11 (centered within grid)

			// Find the center of the section
			const sectionCenterX = (x1 + x2) / 2

			// Calculate the max grid width (based on widest row)
			const maxGridWidth = (maxSeatsInRow - 1) * fixedSeatSpacing

			// Calculate the actual width of this row
			const actualRowWidth = totalPositions > 1 ? (totalPositions - 1) * fixedSeatSpacing : 0

			// Center this row within the max grid
			// rowStartX should position the row so it's centered in the section
			rowStartX = sectionCenterX - (actualRowWidth / 2)

			// Add curve depth for cone pattern using section-specific multiplier
			// Use minimum of 15 pixels or configured percentage of row spacing to ensure visible curve
			curveDepth = Math.max(15, calculatedRowSpacing * configCurveDepthMultiplier) // At least 15px or configured percentage of row spacing

		} else if (presentationStyle === 'left_fixed') {
			rowStartX = x1 + marginX
			curveDepth = 0 // No curve for left_fixed
		} else if (presentationStyle === 'right_fixed') {
			// Right fixed: align all rows to right edge
			const maxRowWidth = (maxSeatsInRow - 1) * fixedSeatSpacing
			rowStartX = x2 - marginX - maxRowWidth
			curveDepth = 0 // No curve for right_fixed
		}

		console.log(`[Row ${rowLabel}] seatCount=${seatCount}, aisleLeft=${aisleLeft}, aisleRight=${aisleRight}, totalPositions=${totalPositions}, rowWidth=${rowWidth.toFixed(2)}, rowStartX=${rowStartX.toFixed(2)}, maxSeatsInRow=${maxSeatsInRow}, fixedSeatSpacing=${fixedSeatSpacing.toFixed(2)}, baseY=${baseY.toFixed(2)}, curveDepth=${curveDepth.toFixed(2)}, presentationStyle=${presentationStyle}`)

		// Get blocked grid positions for this row (obstructions)
		const blockedSeats = rowConfig.blockedSeats || []

		// Calculate total grid positions needed (aisleLeft + seats + aisleRight)
		// Blocked seats are positions within this range that are skipped, they don't extend the range
		const maxGridPosition = aisleLeft + seatCount + aisleRight

		// Calculate row center for curve calculation (based on actual SEAT positions, not including aisles)
		// Seats occupy grid positions: aisleLeft to (aisleLeft + seatCount - 1)
		const firstSeatGridPosition = aisleLeft
		const lastSeatGridPosition = aisleLeft + seatCount - 1
		const rowCenterGridPosition = (firstSeatGridPosition + lastSeatGridPosition) / 2
		const maxDistanceFromCenter = Math.max(1, (lastSeatGridPosition - firstSeatGridPosition) / 2) // Maximum distance from center (min 1 to avoid division by zero)

		// Get seat numbering direction from section configuration
		const numberingDirection = section.seatNumberingDirection || 'left-to-right'

		// Generate seats for this row
		// First, collect all seats with their positions
		const rowSeats = []
		let seatsPlaced = 0

		for (let gridPosition = aisleLeft; gridPosition < maxGridPosition && seatsPlaced < seatCount && placeIndex < placeIds.length; gridPosition++) {
			// Skip if this grid position is blocked
			if (blockedSeats.includes(gridPosition)) {
				continue
			}

			const placeId = placeIds[placeIndex]

			// Calculate X position using the grid position (which may have gaps)
			const x = rowStartX + (gridPosition * fixedSeatSpacing) + offsetX

			// Calculate Y position with curve for cone/fan patterns
			let y = baseY
			if (curveDepth > 0 && maxDistanceFromCenter > 0) {
				// Calculate distance from center (normalized 0-1)
				const distanceFromCenter = Math.abs(gridPosition - rowCenterGridPosition)
				const normalizedDistance = Math.min(1.0, distanceFromCenter / maxDistanceFromCenter) // Clamp to [0, 1]

				// Apply parabolic curve for theater-style fan-out:
				// - Edge seats are pushed FORWARD (lower Y, toward stage at top)
				// - Center seats remain at their base position
				// This creates rows that curve TOWARD the stage (assuming stage is at top/low Y)
				// Formula: offset = -curveDepth * normDist² (edges get negative offset = pushed up/forward)
				const curveOffset = -curveDepth * normalizedDistance * normalizedDistance
				y = baseY + curveOffset
			}

			// Check if this position is within section bounds and not in an obstruction
			const isWithinBounds = x >= x1 && x <= x2 && y >= y1 && y <= y2
			const isInObstruction = isPointInObstruction({ x, y }, section.obstructions || [])

			// Place seat if not in obstruction
			// For rectangle sections, we prioritize seats within bounds, but if we need more seats
			// to meet the required count, we allow seats slightly outside the bounds
			// This ensures we always generate the exact number of seats specified in rowConfig
			if (!isInObstruction) {
				// Always place seat if not in obstruction (even if slightly outside bounds)
				// The bounds are a guide, but we must generate all required seats
				rowSeats.push({
					placeId,
					x,
					y,
					gridPosition
				})
				seatsPlaced++
				placeIndex++
			}
			// If in obstruction, skip this grid position (don't consume placeId, continue to next)
		}

		// Sort seats by X position to ensure correct ordering
		rowSeats.sort((a, b) => a.x - b.x)

		// Assign seat numbers based on numbering direction
		// left-to-right: seat 1 is on the left (lowest X), numbers increase to the right
		// right-to-left: seat 1 is on the right (highest X), numbers increase to the left
		if (numberingDirection === 'right-to-left') {
			rowSeats.reverse() // Reverse order so seat 1 is on the right
		}

		// Assign seat numbers and add to places array
		const assignedSeatNumbers = []
		rowSeats.forEach((seat, index) => {
			const actualSeatNumber = startSeatNumber + index
			assignedSeatNumbers.push(actualSeatNumber)
			places.push({
				placeId: seat.placeId,
				x: seat.x,
				y: seat.y,
				row: rowLabel,
				seat: `${actualSeatNumber}`, // Continuous seat numbering based on direction
				section: section.name || 'Unknown',
				zone: section.priceTier || null
			})
		})

		// Log seat number range for debugging
		if (assignedSeatNumbers.length > 0) {
			const minSeat = Math.min(...assignedSeatNumbers)
			const maxSeat = Math.max(...assignedSeatNumbers)
			console.log(`[Row ${rowLabel}] Assigned ${assignedSeatNumbers.length} seats with numbers ${minSeat}-${maxSeat} (expected ${seatCount} seats from ${startSeatNumber} to ${startSeatNumber + seatCount - 1})`)
		}
	})

	return places
}

/**
 * Calculate the area of a polygon using the shoelace formula
 * @param {Array<{x: number, y: number}>} polygon - Array of polygon points
 * @returns {number} Area of the polygon
 */
const calculatePolygonArea = (polygon) => {
	if (!polygon || polygon.length < 3) return 0

	let area = 0
	for (let i = 0; i < polygon.length; i++) {
		const j = (i + 1) % polygon.length
		area += polygon[i].x * polygon[j].y
		area -= polygon[j].x * polygon[i].y
	}
	return Math.abs(area / 2)
}

/**
 * Calculate the minimum required area based on seat configuration
 * Uses actual calculated spacing from polygon bounds, not raw config values
 * @param {Object} section - Section configuration with rowConfig
 * @param {Object} spacing - Spacing configuration
 * @param {number} sectionWidth - Actual width of the section (from polygon bounds)
 * @param {number} sectionHeight - Actual height of the section (from polygon bounds)
 * @returns {number} Minimum required area in square units
 */
const calculateRequiredArea = (section, spacing, sectionWidth, sectionHeight) => {
	if (!section.rowConfig || section.rowConfig.length === 0) {
		// Fallback to capacity-based estimate
		const capacity = section.capacity || (section.rows || 0) * (section.seatsPerRow || 0)
		// Use actual section dimensions for better estimate
		return sectionWidth * sectionHeight * 0.8 // Assume 80% utilization
	}

	// Calculate from rowConfig using actual section dimensions
	const sortedRows = [...section.rowConfig].sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0))
	const totalRows = sortedRows.length

	// Find the maximum seats in any row (including aisles)
	const maxSeatsPerRow = Math.max(...sortedRows.map(row => {
		const seatCount = row.seatCount || 0
		const aisleLeft = row.aisleLeft || 0
		const aisleRight = row.aisleRight || 0
		return seatCount + aisleLeft + aisleRight
	}))

	// Calculate actual spacing that will be used (based on section dimensions)
	const marginX = Math.max(5, sectionWidth * 0.02)
	const marginY = Math.max(5, sectionHeight * 0.02)
	const availableWidth = sectionWidth - (marginX * 2)
	const availableHeight = sectionHeight - (marginY * 2)

	// Calculate spacing that will actually be used
	const calculatedSeatSpacing = maxSeatsPerRow > 1 ? availableWidth / (maxSeatsPerRow - 1) : availableWidth
	const calculatedRowSpacing = totalRows > 1 ? availableHeight / (totalRows - 1) : availableHeight

	// Calculate required width and height based on actual spacing
	const requiredWidth = maxSeatsPerRow * calculatedSeatSpacing
	const requiredHeight = totalRows * calculatedRowSpacing

	// Return estimated area (width * height)
	return requiredWidth * requiredHeight
}

/**
 * Get the left and right X bounds of a polygon at a specific Y position
 * This handles irregular polygon shapes like trapezoids
 * @param {Array<{x: number, y: number}>} polygon - Array of polygon vertices
 * @param {number} y - The Y position to find bounds at
 * @returns {{leftX: number, rightX: number} | null} - Left and right bounds, or null if no intersection
 */
const getPolygonBoundsAtY = (polygon, y) => {
	if (!polygon || polygon.length < 3) return null

	const intersections = []

	// Check each edge of the polygon
	for (let i = 0; i < polygon.length; i++) {
		const p1 = polygon[i]
		const p2 = polygon[(i + 1) % polygon.length]

		// Check if the Y value is within this edge's Y range
		const minEdgeY = Math.min(p1.y, p2.y)
		const maxEdgeY = Math.max(p1.y, p2.y)

		if (y >= minEdgeY && y <= maxEdgeY) {
			// Handle horizontal edges
			if (Math.abs(p1.y - p2.y) < 0.001) {
				// Horizontal edge - add both endpoints
				intersections.push(p1.x, p2.x)
			} else {
				// Calculate X at this Y using linear interpolation
				const t = (y - p1.y) / (p2.y - p1.y)
				const x = p1.x + t * (p2.x - p1.x)
				intersections.push(x)
			}
		}
	}

	if (intersections.length < 2) return null

	const leftX = Math.min(...intersections)
	const rightX = Math.max(...intersections)

	return { leftX, rightX }
}

/**
 * Generate seats within a polygon section using rowConfig (variable row configuration)
 * Each row can have different number of seats, aisles, and offsets
 * The polygon is used as a reference/model to determine the seating design
 */
const generateSeatsInPolygonWithRowConfig = (section, placeIds, spacing, seatOffset = 0) => {
	const { seatSpacing = 2, rowSpacing = 3 } = spacing
	const places = []

	// Calculate bounding box from polygon
	const rawPolygon = section.polygon || []
	const polygon = rawPolygon.map(p => {
		const point = p.toObject ? p.toObject() : p
		return {
			x: typeof point.x === 'number' ? point.x : parseFloat(point.x) || 0,
			y: typeof point.y === 'number' ? point.y : parseFloat(point.y) || 0
		}
	}).filter(p => !isNaN(p.x) && !isNaN(p.y))

	if (polygon.length < 3) {
		console.warn(`Section ${section.name}: Invalid polygon, need at least 3 points`)
		return places
	}

	const minX = Math.min(...polygon.map(p => p.x))
	const maxX = Math.max(...polygon.map(p => p.x))
	const minY = Math.min(...polygon.map(p => p.y))
	const maxY = Math.max(...polygon.map(p => p.y))

	const sectionWidth = maxX - minX
	const sectionHeight = maxY - minY

	// Get spacing configuration from section (with defaults)
	// Default multipliers are 1.0 to fill the full polygon area
	const spacingConfig = section.spacingConfig || {}
	// REDUCED default topPadding from 40 to 5 - let the spacing multiplier control density instead
	// Get presentation style FIRST (needed for curve direction default)
	const presentationStyle = section.presentationStyle || 'flat'

	const configTopPadding = spacingConfig.topPadding !== undefined ? spacingConfig.topPadding : 5
	const configSeatSpacingMultiplier = spacingConfig.seatSpacingMultiplier !== undefined ? spacingConfig.seatSpacingMultiplier : 1.0
	const configRowSpacingMultiplier = spacingConfig.rowSpacingMultiplier !== undefined ? spacingConfig.rowSpacingMultiplier : 1.0
	const configCurveDepthMultiplier = spacingConfig.curveDepthMultiplier !== undefined ? spacingConfig.curveDepthMultiplier : 0.7
	// Curve direction: 'smile' = edges curve away from stage (down), 'frown' = edges curve toward stage (up)
	// Default to 'frown' for cone style - more natural theater look where edges reach toward stage
	// Only applies to cone style - other styles ignore this setting
	const configCurveDirection = presentationStyle === 'cone'
		? (spacingConfig.curveDirection || 'frown')  // Default frown for cone
		: 'smile'  // Ignored for non-cone styles

	// Calculate automatic rotation angle based on polygon shape if not specified
	let automaticRotationAngle = 0
	if (!spacingConfig.rotationAngle || spacingConfig.rotationAngle === 0) {
		// Calculate angle based on polygon boundaries
		const topBounds = getPolygonBoundsAtY(polygon, minY + 10) // Near top
		const bottomBounds = getPolygonBoundsAtY(polygon, maxY - 10) // Near bottom

		if (topBounds && bottomBounds) {
			const leftSlope = (bottomBounds.leftX - topBounds.leftX) / (maxY - minY)
			const rightSlope = (bottomBounds.rightX - topBounds.rightX) / (maxY - minY)

			// Use average slope, convert to degrees
			const avgSlope = (leftSlope + rightSlope) / 2
			automaticRotationAngle = Math.atan(avgSlope) * (180 / Math.PI)
		}
	}

	// Seat rotation angle in degrees - for angled sections/polygons
	const configRotationAngle = spacingConfig.rotationAngle !== undefined ? spacingConfig.rotationAngle : automaticRotationAngle

	// Top/Bottom margin for rows - gives space for curves (especially for frown direction)
	// Default 10px for cone style (needs room to curve up), 5px for others
	const configTopMarginY = spacingConfig.topMarginY !== undefined ? spacingConfig.topMarginY : (presentationStyle === 'cone' ? 10 : 5)
	const configBottomMarginY = spacingConfig.bottomMarginY !== undefined ? spacingConfig.bottomMarginY : (presentationStyle === 'cone' ? 10 : 5)

	// Sort rowConfig by rowNumber
	const sortedRows = [...(section.rowConfig || [])].sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0))
	const totalRows = sortedRows.length

	// Margins for X (sides) - 2% of section width, minimum 2px
	const marginX = Math.max(2, sectionWidth * 0.02)
	// Use configurable top/bottom margins for Y
	const marginY = Math.max(configTopMarginY, configBottomMarginY) // Use larger of the two for general calculations

	// CRITICAL FIX: Calculate consistent seat spacing based on the WIDEST row
	const maxSeatsInRow = Math.max(...sortedRows.map(row => {
		const seatCount = row.seatCount || section.seatsPerRow || 20
		const aisleLeft = row.aisleLeft || 0
		const aisleRight = row.aisleRight || 0
		return seatCount + aisleLeft + aisleRight
	}))

	// Reduce marginX when using very small multipliers to allow tighter spacing
	const adjustedMarginX = configSeatSpacingMultiplier < 0.3 ? 5 : marginX
	const availableWidth = sectionWidth - (adjustedMarginX * 2)
	// Use section-specific seat spacing multiplier
	// IMPORTANT: Multipliers should constrain seats to fit within the polygon
	// A multiplier < 1.0 makes seats tighter (smaller area used)
	// A multiplier of 1.0 uses the full available space
	// Allow very small multipliers (0.01 - 1.0) for tight spacing - removed 0.75 minimum
	const clampedSeatSpacingMultiplier = Math.max(0.01, Math.min(1.0, configSeatSpacingMultiplier))
	// Adjust spacingFactor based on multiplier: very small multipliers need more available space
	// For tight spacing (multiplier < 0.3), use full width; for normal spacing, use 99%
	const spacingFactor = clampedSeatSpacingMultiplier < 0.3 ? 1.0 : 0.99
	const effectiveWidth = availableWidth * spacingFactor
	console.log(`[generateSeatsInPolygonWithRowConfig] Seat spacing calculation: availableWidth=${availableWidth.toFixed(2)}, maxSeatsInRow=${maxSeatsInRow}, spacingFactor=${spacingFactor}, multiplier=${clampedSeatSpacingMultiplier}, effectiveWidth=${effectiveWidth.toFixed(2)}`)
	const fixedSeatSpacing = maxSeatsInRow > 1 ?
		(effectiveWidth / (maxSeatsInRow - 1)) * clampedSeatSpacingMultiplier :
		effectiveWidth * clampedSeatSpacingMultiplier
	console.log(`[generateSeatsInPolygonWithRowConfig] Final fixedSeatSpacing=${fixedSeatSpacing.toFixed(2)}`)

	// Calculate row spacing with section-specific top padding
	const topPadding = configTopPadding
	// Use section-specific row spacing multiplier
	// Clamp to max 1.0 to ensure rows don't exceed polygon height
	const clampedRowSpacingMultiplier = Math.min(1.0, configRowSpacingMultiplier)
	const calculatedRowSpacing = totalRows > 1 ? ((sectionHeight - topPadding - configTopMarginY - configBottomMarginY) / (totalRows - 1)) * clampedRowSpacingMultiplier : 0

	// Estimate max curve depth for cone style to reserve space for curve
	// Curve depth is based on row width, so use a representative width (average of top/bottom)
	const topBounds = getPolygonBoundsAtY(polygon, minY + configTopMarginY + 5)
	const bottomBounds = getPolygonBoundsAtY(polygon, maxY - configBottomMarginY - 5)
	const avgRowWidth = topBounds && bottomBounds
		? ((topBounds.rightX - topBounds.leftX) + (bottomBounds.rightX - bottomBounds.leftX)) / 2
		: availableWidth
	const curveAsPercentOfWidth = configCurveDepthMultiplier / 10
	const estimatedMaxCurveDepth = presentationStyle === 'cone'
		? Math.max(15, avgRowWidth * curveAsPercentOfWidth)
		: 0

	// Calculate row Y distribution values
	// For FROWN curve (edges UP), reserve space at TOP for curve to go upward
	// For SMILE curve (edges DOWN), reserve space at BOTTOM for curve to go downward
	const curveReserveTop = (presentationStyle === 'cone' && configCurveDirection === 'frown') ? estimatedMaxCurveDepth : 0
	const curveReserveBottom = (presentationStyle === 'cone' && configCurveDirection === 'smile') ? estimatedMaxCurveDepth : 0

	// For fixed alignments, start rows from top without margins
	const firstRowY = (presentationStyle === 'left_fixed' || presentationStyle === 'right_fixed' || presentationStyle === 'flat')
		? minY + curveReserveTop  // No margins for fixed alignments and flat
		: minY + configTopMarginY + topPadding + curveReserveTop
	const lastRowY = maxY - configBottomMarginY - curveReserveBottom
	const availableHeightForRows = lastRowY - firstRowY
	const rowSpacingForAllRows = totalRows > 1 ? availableHeightForRows / (totalRows - 1) : 0

	// Debug logging for cone/fan shape issues
	console.log(`\n========== [generatePolygonSeatsWithRowConfig] Section: ${section.name} ==========`)
	console.log(`  INPUT spacingConfig:`)
	console.log(`    - seatRadius: ${spacingConfig.seatRadius ?? 'not set'}`)
	console.log(`    - seatSpacingMultiplier: ${spacingConfig.seatSpacingMultiplier ?? 'not set'} → clamped: ${clampedSeatSpacingMultiplier}`)
	console.log(`    - rowSpacingMultiplier: ${spacingConfig.rowSpacingMultiplier ?? 'not set'} → clamped: ${clampedRowSpacingMultiplier}`)
	console.log(`    - curveDepthMultiplier: ${spacingConfig.curveDepthMultiplier ?? 'not set'}`)
	console.log(`    - curveDirection: ${spacingConfig.curveDirection ?? 'not set'}`)
	console.log(`    - rotationAngle: ${spacingConfig.rotationAngle ?? 'not set'} → resolved: ${configRotationAngle}° ${spacingConfig.rotationAngle ? '(manual)' : `(auto: ${automaticRotationAngle.toFixed(2)}°)`}`)
	console.log(`    - topPadding: ${spacingConfig.topPadding ?? 'not set'}`)
	console.log(`    - topMarginY: ${spacingConfig.topMarginY ?? 'not set'} → resolved: ${configTopMarginY}`)
	console.log(`    - bottomMarginY: ${spacingConfig.bottomMarginY ?? 'not set'} → resolved: ${configBottomMarginY}`)
	console.log(`  CONFIGURATION (resolved):`)
	console.log(`    - presentationStyle: ${presentationStyle}`)
	console.log(`    - curveDirection: ${configCurveDirection} (smile=edges down, frown=edges up)`)
	console.log(`    - curveDepthMultiplier: ${configCurveDepthMultiplier}`)
	console.log(`    - totalRows: ${totalRows}`)
	console.log(`    - rowConfigs: ${JSON.stringify(sortedRows.map(r => ({ row: r.rowNumber || r.rowLabel, seats: r.seatCount })))}`)
	console.log(`  DIMENSIONS:`)
	console.log(`    - sectionHeight: ${sectionHeight.toFixed(2)}, sectionWidth: ${sectionWidth.toFixed(2)}`)
	console.log(`    - topPadding: ${topPadding}, topMarginY: ${configTopMarginY}, bottomMarginY: ${configBottomMarginY}, marginX: ${marginX.toFixed(2)}`)
	console.log(`  POLYGON BOUNDS:`)
	console.log(`    - minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}`)
	console.log(`    - minY=${minY.toFixed(2)}, maxY=${maxY.toFixed(2)}`)
	console.log(`  CURVE RESERVE (for cone style):`)
	console.log(`    - estimatedMaxCurveDepth: ${estimatedMaxCurveDepth.toFixed(2)}px`)
	console.log(`    - curveReserveTop: ${curveReserveTop.toFixed(2)}px (for frown)`)
	console.log(`    - curveReserveBottom: ${curveReserveBottom.toFixed(2)}px (for smile)`)
	console.log(`  ROW Y DISTRIBUTION:`)
	console.log(`    - firstRowY (row 1): ${firstRowY.toFixed(2)} = minY(${minY.toFixed(2)}) + topMargin(${configTopMarginY}) + topPadding(${topPadding}) + curveReserve(${curveReserveTop.toFixed(2)})`)
	console.log(`    - lastRowY (row ${totalRows}): ${lastRowY.toFixed(2)}`)
	console.log(`    - rowSpacing: ${rowSpacingForAllRows.toFixed(2)}`)
	console.log(`    - availableHeight: ${availableHeightForRows.toFixed(2)}`)
	console.log(`  EXPECTED ROW POSITIONS:`)
	for (let i = 0; i < totalRows; i++) {
		const expectedY = firstRowY + (i * rowSpacingForAllRows)
		console.log(`    - Row ${i + 1}: Y=${expectedY.toFixed(2)} (${expectedY >= minY && expectedY <= maxY ? 'IN BOUNDS' : 'OUT OF BOUNDS!'})`)
	}
	console.log(`  ----------------------------------------`)

	// Check if any row has manual Y offsets - if so, use offset-based positioning instead of calculated spacing
	const hasManualYOffsets = sortedRows.some(row => {
		const oy = typeof row.offsetY === 'string' ? parseFloat(row.offsetY) : (row.offsetY || 0)
		return oy !== 0
	})

	// Debug: Log all row offsets to verify they're being read correctly
	console.log(`[generateSeatsInPolygonWithRowConfig] Section: ${section.name}`)
	console.log(`[generateSeatsInPolygonWithRowConfig] hasManualYOffsets: ${hasManualYOffsets}`)
	console.log(`[generateSeatsInPolygonWithRowConfig] Row offsets:`, sortedRows.map((r, i) => ({
		index: i,
		rowNumber: r.rowNumber,
		rowLabel: r.rowLabel,
		offsetY: r.offsetY,
		offsetYType: typeof r.offsetY,
		offsetYParsed: typeof r.offsetY === 'string' ? parseFloat(r.offsetY) : (r.offsetY || 0)
	})))
	console.log(`[generateSeatsInPolygonWithRowConfig] Row spacing for all rows: ${rowSpacingForAllRows.toFixed(2)}`)

	let placeIndex = 0

	sortedRows.forEach((rowConfig, rowArrayIndex) => {
		const rowNumber = rowConfig.rowNumber || (rowArrayIndex + 1)
		const rowLabel = rowConfig.rowLabel || `R${rowNumber}`
		const seatCount = rowConfig.seatCount || section.seatsPerRow || 20
		const startSeatNumber = rowConfig.startSeatNumber || 1
		const aisleLeft = rowConfig.aisleLeft || 0
		const aisleRight = rowConfig.aisleRight || 0
		const offsetX = rowConfig.offsetX || 0
		// Ensure offsetY is a number, handle string conversion
		const offsetY = typeof rowConfig.offsetY === 'string' ? parseFloat(rowConfig.offsetY) || 0 : (rowConfig.offsetY || 0)

		// Calculate base Y position for this row
		// If manual Y offsets are used, ignore calculated spacing and use offsets as spacing from previous row
		// Otherwise, use calculated spacing with optional offset for fine-tuning
		let baseY
		if (hasManualYOffsets) {
			// Manual offset mode: offsetY represents spacing from the PREVIOUS row
			// First row starts at firstRowY + its own offsetY
			// Each subsequent row is positioned at: previous row's Y + current row's offsetY
			if (rowArrayIndex === 0) {
				baseY = firstRowY + offsetY
			} else {
				// Calculate previous row's baseY by iterating through all previous rows
				let prevBaseY = firstRowY
				for (let i = 0; i < rowArrayIndex; i++) {
					const prevOffsetY = typeof sortedRows[i].offsetY === 'string' ? parseFloat(sortedRows[i].offsetY) || 0 : (sortedRows[i].offsetY || 0)
					prevBaseY += prevOffsetY
				}
				// Current row's position = previous row's position + current row's offsetY
				baseY = prevBaseY + offsetY
			}
			console.log(`[Row ${rowLabel}] Manual offset mode (polygon): rowArrayIndex=${rowArrayIndex}, offsetY=${offsetY}, baseY=${baseY.toFixed(2)}, firstRowY=${firstRowY.toFixed(2)}`)
		} else {
			// Automatic spacing mode: Use calculated spacing with optional fine-tuning offset
			baseY = firstRowY + (rowArrayIndex * rowSpacingForAllRows) + offsetY
			console.log(`[Row ${rowLabel}] Auto spacing mode (polygon): rowArrayIndex=${rowArrayIndex}, rowSpacingForAllRows=${rowSpacingForAllRows.toFixed(2)}, offsetY=${offsetY}, baseY=${baseY.toFixed(2)}`)
		}

		// Debug: Log row Y position calculations
		console.log(`  [Row ${rowLabel}] Processing...`)
		console.log(`    - rowArrayIndex: ${rowArrayIndex}, baseY: ${baseY.toFixed(2)}`)
		console.log(`    - offsetY: ${offsetY}, seatCount: ${seatCount}`)

		// Get the actual polygon bounds at this row's Y position (for trapezoid/irregular polygons)
		const polygonBounds = getPolygonBoundsAtY(polygon, baseY)

		// If polygonBounds is null, this row's Y is outside the polygon - skip entire row
		if (!polygonBounds) {
			console.error(`  [Row ${rowLabel}] ❌ SKIPPED - NO POLYGON BOUNDS at Y=${baseY.toFixed(2)}!`)
			console.error(`    - Polygon Y range: ${minY.toFixed(2)} to ${maxY.toFixed(2)}`)
			console.error(`    - Is baseY in range? ${baseY >= minY && baseY <= maxY}`)
			return // Skip this row entirely - no seats can be placed
		}

		// Use polygon bounds if available, otherwise fall back to bounding box
		const rowLeftBound = polygonBounds.leftX + marginX
		const rowRightBound = polygonBounds.rightX - marginX
		const rowAvailableWidth = rowRightBound - rowLeftBound
		const rowCenterX = (rowLeftBound + rowRightBound) / 2

		console.log(`    - polygonBounds at Y=${baseY.toFixed(2)}: left=${polygonBounds.leftX.toFixed(2)}, right=${polygonBounds.rightX.toFixed(2)}`)
		console.log(`    - rowAvailableWidth: ${rowAvailableWidth.toFixed(2)}`)

		// Calculate total positions needed
		const totalPositions = seatCount + aisleLeft + aisleRight

		// Calculate seat spacing for THIS ROW based on actual available width at this Y position
		const rowSeatSpacing = totalPositions > 1
			? (rowAvailableWidth / (totalPositions - 1)) * clampedSeatSpacingMultiplier
			: rowAvailableWidth * clampedSeatSpacingMultiplier

		const rowWidth = totalPositions > 1 ? (totalPositions - 1) * rowSeatSpacing : 0

		// Debug: Log spacing calculation
		console.log(`    - totalPositions: ${totalPositions}, rowSeatSpacing: ${rowSeatSpacing.toFixed(2)}px, rowWidth: ${rowWidth.toFixed(2)}px`)

		// Calculate row start X based on presentation style
		let rowStartX
		// FOCAL POINT for radial alignment (defined once for all rows)
		const focalPointX = rowCenterX
		const focalPointY = minY - (sectionHeight * 0.3) // 30% of section height in front

		// Curve depth for cone/fan patterns (as percentage of row spacing)
		let curveDepth = 0
		// Actual seat spacing and width to use (may be adjusted per presentation style)
		let actualSeatSpacing = rowSeatSpacing
		let actualRowWidth = rowWidth

		if (presentationStyle === 'flat') {
			// Flat: Distribute seats across full section width for even layout
			actualSeatSpacing = fixedSeatSpacing
			actualRowWidth = totalPositions > 1 ? (totalPositions - 1) * actualSeatSpacing : 0
			const sectionCenterX = (minX + maxX) / 2
			rowStartX = sectionCenterX - (actualRowWidth / 2)
			curveDepth = 0 // No curve for flat

		} else if (presentationStyle === 'cone') {
			// UNIFORM CONE: Every row treated equally with same spacing, centering, and curves
			// Cone effect emerges naturally from different seat counts in uniform grid

			// Use FIXED spacing (same for all rows) - ensures vertical alignment
			actualSeatSpacing = fixedSeatSpacing

			// Calculate this row's width using fixed spacing
			let actualRowWidth = totalPositions > 1 ? (totalPositions - 1) * actualSeatSpacing : 0

			// Allow row to overflow polygon bounds - place all seats regardless of polygon constraints
			// This ensures complete seat placement even if seats extend beyond section boundaries
			const polygonWidth = rowRightBound - rowLeftBound
			console.log(`    [ROW OVERFLOW ALLOWED] Polygon width ${polygonWidth.toFixed(2)}, row width ${actualRowWidth.toFixed(2)} (${actualRowWidth > polygonWidth ? 'overflow' : 'fits'})`)

			// Center row within section bounds for consistent alignment
			// Use section center for uniform centering across all rows
			const sectionCenterX = (minX + maxX) / 2
			rowStartX = sectionCenterX - (actualRowWidth / 2)

			// Curve depth: 2-3% of max grid width
			const maxGridWidth = (maxSeatsInRow - 1) * fixedSeatSpacing
			curveDepth = maxGridWidth * 0.025 * configCurveDepthMultiplier
			curveDepth = Math.max(10, Math.min(curveDepth, 50))

			// Debug: Log uniform cone setup (once per section)
			if (rowArrayIndex === 0) {
				console.log(`  [UNIFORM CONE] Max grid width: ${maxGridWidth.toFixed(2)}px`)
				console.log(`  [UNIFORM CONE] Fixed spacing: ${fixedSeatSpacing.toFixed(2)}px`)
				console.log(`  [UNIFORM CONE] Every row treated equally - same spacing, centering, curves`)
				console.log(`  [UNIFORM CONE] Curve Direction: FROWN (^ shape - edges curve UP toward stage)`)
			}
			console.log(`  [Row ${rowLabel}] seats=${totalPositions}, rowWidth=${actualRowWidth.toFixed(2)}, sectionCenter=${sectionCenterX.toFixed(2)}, startX=${rowStartX.toFixed(2)}, curveDepth=${curveDepth.toFixed(2)}px`)

		} else if (presentationStyle === 'left_fixed') {
			// Left fixed: Use fixed spacing like cone, align to left edge
			actualSeatSpacing = fixedSeatSpacing
			actualRowWidth = totalPositions > 1 ? (totalPositions - 1) * actualSeatSpacing : 0
			rowStartX = rowLeftBound
			curveDepth = 0 // No curve for left_fixed
		} else if (presentationStyle === 'right_fixed') {
			// Right fixed: Use fixed spacing like cone, align to right edge
			actualSeatSpacing = fixedSeatSpacing
			actualRowWidth = totalPositions > 1 ? (totalPositions - 1) * actualSeatSpacing : 0
			rowStartX = rowRightBound - actualRowWidth
			curveDepth = 0 // No curve for right_fixed
		}

		// EDGE DEBUG: Show first and last seat X positions for this row
		const firstSeatX = rowStartX + (aisleLeft * actualSeatSpacing)
		const lastSeatX = rowStartX + ((aisleLeft + seatCount - 1) * actualSeatSpacing)
		console.log(`    - EDGE POSITIONS: firstSeatX=${firstSeatX.toFixed(2)}, lastSeatX=${lastSeatX.toFixed(2)}, rowStartX=${rowStartX.toFixed(2)}`)

		// Get blocked grid positions for this row (obstructions)
		const blockedSeats = rowConfig.blockedSeats || []

		// Calculate total grid positions needed (seats + blocked positions)
		const maxGridPosition = aisleLeft + seatCount + blockedSeats.length

		// Calculate row center for curve calculation (based on actual SEAT positions, not including aisles)
		// Seats occupy grid positions: aisleLeft to (aisleLeft + seatCount - 1)
		const firstSeatGridPosition = aisleLeft
		const lastSeatGridPosition = aisleLeft + seatCount - 1
		const rowCenterGridPosition = (firstSeatGridPosition + lastSeatGridPosition) / 2
		const maxDistanceFromCenter = Math.max(1, (lastSeatGridPosition - firstSeatGridPosition) / 2) // Maximum distance from center (min 1 to avoid division by zero)

		// Get seat numbering direction from section configuration
		const numberingDirection = section.seatNumberingDirection || 'left-to-right'

		// Generate seats for this row
		// First, collect all seats with their positions
		const rowSeats = []
		let seatsPlaced = 0
		let seatsSkippedObstruction = 0
		let seatsOutsidePolygon = 0

		// Continue until we've placed all required seats or run out of grid positions
		for (let gridPosition = aisleLeft; gridPosition < maxGridPosition && seatsPlaced < seatCount; gridPosition++) {
			// Skip if this grid position is blocked
			if (blockedSeats.includes(gridPosition)) {
				continue
			}

			// Check if we have enough placeIds
			if (placeIndex >= placeIds.length) {
				console.warn(`[Row ${rowLabel}] Ran out of placeIds! Need ${seatCount} seats, placed ${seatsPlaced}, gridPos=${gridPosition}, maxGridPos=${maxGridPosition}`)
				break
			}

			const placeId = placeIds[placeIndex]

			// Calculate X position using FIXED spacing (ensures vertical alignment)
			// All rows use same spacing so seats align vertically like in screenshot
			const x = rowStartX + (gridPosition * actualSeatSpacing) + offsetX

			// Calculate Y position (with curve for cone/fan patterns)
			let y = baseY
			let curveOffset = 0

			// Debug: Log curveDepth for first seat of each row
			if (gridPosition === aisleLeft) {
				console.log(`    [Row ${rowLabel}] curveDepth=${curveDepth}, maxDistanceFromCenter=${maxDistanceFromCenter}, presentationStyle=${presentationStyle}`)
			}

			if (curveDepth > 0 && maxDistanceFromCenter > 0) {
				// Calculate distance from center (normalized 0-1)
				const distanceFromCenter = Math.abs(gridPosition - rowCenterGridPosition)
				const normalizedDistance = Math.min(1.0, distanceFromCenter / maxDistanceFromCenter) // Clamp to [0, 1]

				// FROWN curve: edges forward (negative Y) - simpler quadratic
				curveOffset = -curveDepth * normalizedDistance * normalizedDistance

				// Clamp frown curve to not go above minY (respect top margin)
				const minAllowedY = minY + configTopMarginY
				if (baseY + curveOffset < minAllowedY) {
					curveOffset = minAllowedY - baseY
				}

				y = baseY + curveOffset
			}

			// Use bounds checking - X is within row bounds, Y is within polygon
			const isWithinBounds = x >= rowLeftBound && x <= rowRightBound &&
			                       y >= minY && y <= maxY
			const isInObstruction = isPointInObstruction({ x, y }, section.obstructions || [])

			// Debug: Log first few seats and any that fail
			if (seatsPlaced < 3 || !isWithinBounds) {
				console.log(`      [Seat ${gridPosition}] x=${x.toFixed(2)}, y=${y.toFixed(2)}, curveOffset=${curveOffset.toFixed(2)}, actualSpacing=${actualSeatSpacing.toFixed(2)}px, inBounds=${isWithinBounds}`)
			}

			// Place seat only if it's within bounds and not in an obstruction
			if (isInObstruction) {
				// Skip this grid position if in obstruction (don't consume placeId)
				seatsSkippedObstruction++
				continue
			}

			// Allow seats outside polygon bounds - place all seats regardless
			// Previously: if (!isWithinBounds) { seatsOutsidePolygon++; continue }

			// Place seat - it's within bounds
			rowSeats.push({
				placeId,
				x,
				y,
				gridPosition,
				isInPolygon: true
			})
			seatsPlaced++
			placeIndex++
		}

		// Log seat placement results
		console.log(`    - RESULT: Placed ${seatsPlaced}/${seatCount} seats`)
		if (seatsSkippedObstruction > 0) console.log(`      - ${seatsSkippedObstruction} skipped (obstruction)`)
		if (seatsOutsidePolygon > 0) console.log(`      - ${seatsOutsidePolygon} skipped (outside polygon)`)

		// Log warning if we didn't place all required seats
		if (seatsPlaced < seatCount) {
			console.warn(`  [Row ${rowLabel}] ⚠️ INCOMPLETE: Only ${seatsPlaced}/${seatCount} seats placed`)
		} else {
			console.log(`    - ✅ Row complete`)
		}

		// Sort seats by X position to ensure correct ordering
		rowSeats.sort((a, b) => a.x - b.x)

		// Assign seat numbers based on numbering direction
		// left-to-right: seat 1 is on the left (lowest X), numbers increase to the right
		// right-to-left: seat 1 is on the right (highest X), numbers increase to the left
		if (numberingDirection === 'right-to-left') {
			rowSeats.reverse() // Reverse order so seat 1 is on the right
		}

		// Assign seat numbers and add to places array
		const assignedSeatNumbers = []
		rowSeats.forEach((seat, index) => {
			const actualSeatNumber = startSeatNumber + index
			assignedSeatNumbers.push(actualSeatNumber)

			// Apply rotation if configured
			let finalX = seat.x
			let finalY = seat.y
			if (configRotationAngle !== 0) {
				const radians = (configRotationAngle * Math.PI) / 180
				const cos = Math.cos(radians)
				const sin = Math.sin(radians)

				// Rotate around section center
				const centerX = (minX + maxX) / 2
				const centerY = (minY + maxY) / 2

				// Translate to origin, rotate, translate back
				const translatedX = seat.x - centerX
				const translatedY = seat.y - centerY

				finalX = translatedX * cos - translatedY * sin + centerX
				finalY = translatedX * sin + translatedY * cos + centerY
			}

			places.push({
				placeId: seat.placeId,
				x: finalX,
				y: finalY,
				row: rowLabel,
				seat: `${actualSeatNumber}`, // Continuous seat numbering based on direction
				section: section.name || 'Unknown',
				zone: section.priceTier || null
			})
		})

		// Log seat number range for debugging
		if (assignedSeatNumbers.length > 0) {
			const minSeat = Math.min(...assignedSeatNumbers)
			const maxSeat = Math.max(...assignedSeatNumbers)
			console.log(`    - Seat numbers: ${minSeat}-${maxSeat}`)
		}
	})

	// Final summary
	console.log(`  ========== SUMMARY ==========`)
	console.log(`  Total seats placed: ${places.length}`)
	console.log(`  Expected rows: ${totalRows}`)
	console.log(`  ==============================\n`)

	return places
}

/**
 * Generate seats within a polygon section
 * Uses a grid approach within the polygon's bounding box
 */
const generateSeatsInPolygon = (section, placeIds, spacing, seatOffset = 0) => {
	const { seatSpacing = 2, rowSpacing = 3 } = spacing
	const places = []

	// Calculate bounding box
	const polygon = section.polygon || []
	if (polygon.length < 3) return places

	const minX = Math.min(...polygon.map(p => p.x))
	const maxX = Math.max(...polygon.map(p => p.x))
	const minY = Math.min(...polygon.map(p => p.y))
	const maxY = Math.max(...polygon.map(p => p.y))

	const width = maxX - minX
	const height = maxY - minY

	// Calculate grid
	const rows = section.rows || Math.ceil(Math.sqrt(placeIds.length / (section.seatsPerRow || 20)))
	const seatsPerRow = section.seatsPerRow || Math.ceil(placeIds.length / rows)

	const calculatedSeatSpacing = (width - (seatSpacing * 2)) / Math.max(seatsPerRow - 1, 1)
	const calculatedRowSpacing = (height - (rowSpacing * 2)) / Math.max(rows - 1, 1)

	let placeIndex = 0
	let seatCounter = 0
	for (let rowIndex = 0; rowIndex < rows && placeIndex < placeIds.length; rowIndex++) {
		for (let seatInRow = 0; seatInRow < seatsPerRow && placeIndex < placeIds.length; seatInRow++) {
			const x = minX + seatSpacing + (seatInRow * calculatedSeatSpacing)
			const y = minY + rowSpacing + (rowIndex * calculatedRowSpacing)

			// Check if point is inside polygon and not in an obstruction
			if (isPointInPolygon({ x, y }, polygon) && !isPointInObstruction({ x, y }, section.obstructions || [])) {
				const placeId = placeIds[placeIndex]
				seatCounter++
				places.push({
					placeId,
					x,
					y,
					row: `R${rowIndex + 1}`,
					seat: `${seatCounter}`,
					section: section.name || 'Unknown',
					zone: section.priceTier || null
				})
				placeIndex++
			}
		}
	}

	return places
}

/**
 * Check if a point is inside a polygon
 * Uses ray casting algorithm
 */
const isPointInPolygon = (point, polygon) => {
	if (!polygon || polygon.length < 3) return false
	let inside = false
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x
		const yi = polygon[i].y
		const xj = polygon[j].x
		const yj = polygon[j].y

		const intersect = ((yi > point.y) !== (yj > point.y)) &&
			(point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
		if (intersect) inside = !inside
	}
	return inside
}

/**
 * Check if a point is within any obstruction
 * @param {Object} point - {x, y}
 * @param {Array} obstructions - Array of obstruction objects
 * @returns {boolean} - True if point is in an obstruction
 */
const isPointInObstruction = (point, obstructions) => {
	if (!obstructions || obstructions.length === 0) return false

	for (const obstruction of obstructions) {
		if (obstruction.shape === 'polygon' && obstruction.polygon && obstruction.polygon.length >= 3) {
			if (isPointInPolygon(point, obstruction.polygon)) {
				return true
			}
		} else if (obstruction.bounds) {
			// Rectangle obstruction
			const { x1, y1, x2, y2 } = obstruction.bounds
			if (point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) &&
				point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) {
				return true
			}
		}
	}
	return false
}

/**
 * Group places by section for analysis
 */
export const groupPlacesBySection = (places) => {
	const groups = {}

	places.forEach(place => {
		const sectionName = place.section || 'Unknown'
		if (!groups[sectionName]) {
			groups[sectionName] = {
				name: sectionName,
				places: [],
				count: 0,
				priceRange: { min: Infinity, max: -Infinity }
			}
		}

		groups[sectionName].places.push(place)
		groups[sectionName].count++

		const price = place.pricing?.currentPrice || place.pricing?.basePrice || 0
		if (price > 0) {
			groups[sectionName].priceRange.min = Math.min(groups[sectionName].priceRange.min, price)
			groups[sectionName].priceRange.max = Math.max(groups[sectionName].priceRange.max, price)
		}
	})

	// Clean up price ranges
	Object.keys(groups).forEach(sectionName => {
		if (groups[sectionName].priceRange.min === Infinity) {
			groups[sectionName].priceRange = { min: 0, max: 0 }
		}
	})

	return groups
}

