import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import { Manifest, Venue } from '../model/mongoModel.js'
import * as common from '../util/common.js'
import { error, info } from '../model/logger.js'
import crypto from 'crypto'
import * as ticketmasterManifest from '../util/ticketmasterManifest.js'
import * as seatmapAlgorithms from '../util/seatmapAlgorithms.js'
import * as manualSectionLayout from '../util/manualSectionLayout.js'
import { uploadManifestToS3 } from '../util/aws.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import * as OutboxMessage from '../model/outboxMessage.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * Generate update hash for manifest
 */
const generateUpdateHash = (places) => {
	if (!places || places.length === 0) return null
	const placeIds = places.map(p => p.placeId).sort()
	return crypto.createHash('md5').update(JSON.stringify(placeIds)).digest('hex')
}

/**
 * Create a new manifest
 */
export const createManifest = async (req, res, next) => {
	try {
		const manifestData = req.body

		// Validate venue exists
		const venue = await Venue.findById(manifestData.venue)
		if (!venue) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Generate update hash and time
		const updateHash = generateUpdateHash(manifestData.places || [])
		const updateTime = Date.now()

		const manifest = new Manifest({
			...manifestData,
			updateHash,
			updateTime
		})

		const savedManifest = await manifest.save()
		return res.status(consts.HTTP_STATUS_OK).json({ data: savedManifest })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get all manifests with optional filters
 */
export const getManifests = async (req, res, next) => {
	try {
		const { venue, merchant } = req.query
		const query = {}

		if (venue) {
			query.venue = venue
		}
		if (merchant) {
			// Find venues for merchant first
			const venues = await Venue.find({ merchant })
			const venueIds = venues.map(v => v._id)
			query.venue = { $in: venueIds }
		}

		const manifests = await Manifest.find(query)
			.populate('venue')
			.sort({ createdAt: -1 })

		return res.status(consts.HTTP_STATUS_OK).json({ data: manifests })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get manifest by ID
 */
export const getManifestById = async (req, res, next) => {
	try {
		const { id } = req.params

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const manifest = await Manifest.findById(id).populate('venue')
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: manifest })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get manifests for a specific venue
 */
export const getManifestsByVenue = async (req, res, next) => {
	try {
		const { venueId } = req.params

		if (!common.validateParam(venueId)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid venue ID',
				error: appText.INVALID_ID
			})
		}

		const manifests = await Manifest.find({ venue: venueId })
			.populate('venue')
			.sort({ createdAt: -1 })

		return res.status(consts.HTTP_STATUS_OK).json({ data: manifests })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Update manifest
 */
export const updateManifest = async (req, res, next) => {
	try {
		const { id } = req.params
		const updateData = req.body

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		// If places are being updated, regenerate hash
		if (updateData.places) {
			updateData.updateHash = generateUpdateHash(updateData.places)
			updateData.updateTime = Date.now()
		}

		updateData.updatedAt = new Date()

		const manifest = await Manifest.findByIdAndUpdate(
			id,
			{ $set: updateData },
			{ new: true, runValidators: true }
		).populate('venue')

		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: manifest })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Delete manifest
 */
export const deleteManifest = async (req, res, next) => {
	try {
		const { id } = req.params

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const manifest = await Manifest.findByIdAndDelete(id)
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Manifest deleted successfully',
			data: manifest
		})
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Add or update a place in manifest
 */
export const addOrUpdatePlace = async (req, res, next) => {
	try {
		const { id } = req.params
		const placeData = req.body

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid manifest ID',
				error: appText.INVALID_ID
			})
		}

		const manifest = await Manifest.findById(id)
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Check if place exists
		const placeIndex = manifest.places.findIndex(p => p.placeId === placeData.placeId)

		if (placeIndex >= 0) {
			// Update existing place
			manifest.places[placeIndex] = { ...manifest.places[placeIndex].toObject(), ...placeData }
		} else {
			// Add new place
			manifest.places.push(placeData)
		}

		// Regenerate hash
		manifest.updateHash = generateUpdateHash(manifest.places)
		manifest.updateTime = Date.now()
		manifest.updatedAt = new Date()

		const savedManifest = await manifest.save()
		return res.status(consts.HTTP_STATUS_OK).json({ data: savedManifest })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Delete a place from manifest
 */
export const deletePlace = async (req, res, next) => {
	try {
		const { id, placeId } = req.params

		if (!common.validateParam(id) || !placeId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const manifest = await Manifest.findById(id)
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		manifest.places = manifest.places.filter(p => p.placeId !== placeId)
		manifest.updateHash = generateUpdateHash(manifest.places)
		manifest.updateTime = Date.now()
		manifest.updatedAt = new Date()

		const savedManifest = await manifest.save()
		return res.status(consts.HTTP_STATUS_OK).json({ data: savedManifest })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Export manifest configuration by ID
 * Returns a versioned JSON payload without Mongo-specific fields
 */
export const exportManifestById = async (req, res, next) => {
	try {
		const { id } = req.params

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const manifest = await Manifest.findById(id).lean()
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Strip Mongo-specific fields from export
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { _id, __v, createdAt, updatedAt, ...data } = manifest

		const exportPayload = {
			version: 1,
			type: 'manifest',
			originalId: _id?.toString(),
			data
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: exportPayload })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Import manifest configuration
 * Supports:
 *  - mode=create (default): create new manifest from exported data
 *  - mode=update: update existing manifest using targetId or body.id
 */
export const importManifest = async (req, res, next) => {
	try {
		const {
			version,
			type,
			data,
			mode = 'create',
			targetId,
			id
		} = req.body || {}

		if (!data || typeof data !== 'object') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid payload: data is required',
				error: 'INVALID_PAYLOAD'
			})
		}

		if (type && type !== 'manifest') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid payload type for manifest import',
				error: 'INVALID_TYPE'
			})
		}

		if (version && version !== 1) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Unsupported manifest export version',
				error: 'UNSUPPORTED_VERSION'
			})
		}

		// Validate venue reference if present
		if (data.venue) {
			const venueExists = await Venue.findById(data.venue)
			if (!venueExists) {
				return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
					message: 'Referenced venue not found for manifest import',
					error: appText.RESOURCE_NOT_FOUND
				})
			}
		}

		// Recalculate hash/time when we touch places
		const places = Array.isArray(data.places) ? data.places : []
		const updateHash = places.length > 0 ? generateUpdateHash(places) : data.updateHash
		const updateTime = places.length > 0 ? Date.now() : (data.updateTime || Date.now())

		if (mode === 'create') {
			const manifest = new Manifest({
				...data,
				updateHash,
				updateTime,
				createdAt: new Date(),
				updatedAt: new Date()
			})

			const saved = await manifest.save()
			return res.status(consts.HTTP_STATUS_OK).json({ data: saved })
		}

		// mode === 'update'
		const target = targetId || id
		if (!target || !common.validateParam(target)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid targetId or id is required for update mode',
				error: appText.INVALID_ID
			})
		}

		const updateData = {
			...data,
			updateHash,
			updateTime,
			updatedAt: new Date()
		}

		const updated = await Manifest.findByIdAndUpdate(
			target,
			{ $set: updateData },
			{ new: true, runValidators: true }
		).populate('venue')

		if (!updated) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: updated })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Generate manifest (similar to Ticketmaster structure)
 * Creates a manifest with placeIds array, updateHash, updateTime
 */
export const generateManifest = async (req, res, next) => {
	try {
		const { eventId, venueId, layoutAlgorithm, layoutConfig, placeGeneration, totalPlaces, placeIds, sectionNaming } = req.body

		if (!venueId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'venueId is required',
				error: appText.INVALID_ID
			})
		}

		// Generate eventId if not provided (for developer reference)
		const finalEventId = eventId || `VENUE-${venueId}-${Date.now()}`

		// Validate venue exists
		const venue = await Venue.findById(venueId)
		if (!venue) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Check if venue has manually configured sections FIRST, before generating placeIds
		const hasManualSections = venue.sections && venue.sections.length > 0

		// If using manual sections, calculate total capacity FIRST to generate correct number of placeIds
		let totalCapacity = 0
		if (hasManualSections) {
			totalCapacity = venue.sections.reduce((sum, section) => {
				let sectionCapacity = 0
				if (section.capacity) {
					sectionCapacity = section.capacity
				} else if (section.rowConfig && Array.isArray(section.rowConfig) && section.rowConfig.length > 0) {
					sectionCapacity = section.rowConfig.reduce((rowSum, row) => rowSum + (row.seatCount || 0), 0)
				} else {
					sectionCapacity = (section.rows || 0) * (section.seatsPerRow || 0)
				}
				console.log(`[generateManifest] Section ${section.name}: capacity = ${sectionCapacity}`)
				return sum + sectionCapacity
			}, 0)
			console.log(`[generateManifest] Calculated totalCapacity from venue sections: ${totalCapacity}`)
		}

		// Generate placeIds if not provided
		// For manual sections, ALWAYS use totalCapacity (ignore totalPlaces from request)
		// For non-manual sections, use totalPlaces from request
		let generatedPlaceIds = placeIds
		if (!generatedPlaceIds || generatedPlaceIds.length === 0) {
			// For manual sections, always use calculated capacity, ignore totalPlaces from request
			const placeIdCount = hasManualSections && totalCapacity > 0
				? totalCapacity
				: (totalPlaces || 100)

			console.log(`[generateManifest] placeIdCount calculation: hasManualSections=${hasManualSections}, totalCapacity=${totalCapacity}, totalPlaces=${totalPlaces}, final placeIdCount=${placeIdCount}`)

			generatedPlaceIds = ticketmasterManifest.generatePlaceIds({
				prefix: placeGeneration?.prefix || '',
				count: placeIdCount,
				pattern: placeGeneration?.pattern || 'sequential',
				patternConfig: placeGeneration?.patternConfig || {}
			})

			console.log(`[generateManifest] generatePlaceIds called with count=${placeIdCount}, returned ${generatedPlaceIds.length} placeIds`)

			if (generatedPlaceIds.length !== placeIdCount) {
				console.error(`[generateManifest] ERROR: Requested ${placeIdCount} placeIds but got ${generatedPlaceIds.length}!`)
			}
		} else if (hasManualSections && totalCapacity > 0) {
			// If placeIds were provided but we have manual sections, check if we need more
			const currentPlaceIdCount = generatedPlaceIds.length
			if (currentPlaceIdCount < totalCapacity) {
				console.log(`[generateManifest] Adjusting placeIds from ${currentPlaceIdCount} to ${totalCapacity} based on venue capacity`)
				generatedPlaceIds = ticketmasterManifest.generatePlaceIds({
					prefix: placeGeneration?.prefix || '',
					count: totalCapacity,
					pattern: placeGeneration?.pattern || 'sequential',
					patternConfig: placeGeneration?.patternConfig || {}
				})
			}
		}

		// Generate manifest structure (Ticketmaster-like format)
		const manifestStructure = ticketmasterManifest.generateManifest({
			eventId: finalEventId,
			placeIds: generatedPlaceIds
		})

		// Normalize to our format
		let normalizedData = ticketmasterManifest.normalizeManifestData(manifestStructure, venueId)

		console.log(`[generateManifest] Final placeIds count: ${manifestStructure.placeIds.length}, normalizedData.places.length: ${normalizedData.places.length}`)

		// Apply layout algorithm if specified OR if manual sections exist
		// Always use manifestStructure.placeIds (which has been updated if needed)
		const placeIdsToUse = manifestStructure.placeIds || []
		if (placeIdsToUse.length > 0 && (layoutAlgorithm || hasManualSections)) {
			let placesWithCoords = []

			// Use manual sections if available, otherwise use algorithm
			if (hasManualSections) {
				// Use manually configured sections
				// Merge layoutConfig from request with venue's layoutConfig, fallback to venue's only
				const mergedLayoutConfig = layoutConfig
					? { ...venue.layoutConfig, ...layoutConfig }
					: (venue.layoutConfig || {})

				console.log(`[generateManifest] Calling generateManualSectionLayout with ${placeIdsToUse.length} placeIds (expected capacity: ${totalCapacity})`)
				placesWithCoords = manualSectionLayout.generateManualSectionLayout(
					{
						sections: venue.sections,
						layoutConfig: mergedLayoutConfig
					},
					placeIdsToUse
				)
				normalizedData.layoutAlgorithm = 'manual'
				normalizedData.coordinateSource = 'manual'
			} else if (layoutAlgorithm === 'grid') {
				placesWithCoords = seatmapAlgorithms.generateGridLayout(
					{ ...layoutConfig, totalSeats: placeIdsToUse.length, sectionNaming },
					placeIdsToUse
				)
			} else if (layoutAlgorithm === 'curved') {
				placesWithCoords = seatmapAlgorithms.generateCurvedLayout(
					layoutConfig,
					placeIdsToUse
				)
			} else if (layoutAlgorithm === 'general') {
				placesWithCoords = seatmapAlgorithms.generateGeneralAdmissionLayout(
					layoutConfig,
					placeIdsToUse
				)
			}

			// Merge coordinates into places
			if (placesWithCoords.length > 0) {
				// For manual sections, replace all places with the generated ones (they have correct section names)
				if (hasManualSections) {
					// Create a map of placeIds to places for quick lookup
					const placeMap = new Map()
					normalizedData.places.forEach(place => {
						placeMap.set(place.placeId, place)
					})

					// Use the places from manualSectionLayout, but preserve any existing pricing/status from normalizedData
					normalizedData.places = placesWithCoords.map(coordPlace => {
						const existingPlace = placeMap.get(coordPlace.placeId)
						if (existingPlace) {
							return {
								...existingPlace,
								x: coordPlace.x,
								y: coordPlace.y,
								row: coordPlace.row,
								seat: coordPlace.seat,
								section: coordPlace.section // Use section from manual layout (ensures correct section name)
							}
						}
						return {
							...coordPlace,
							pricing: coordPlace.pricing || { basePrice: 0, currency: 'EUR' },
							available: true,
							status: 'available'
						}
					})
				} else {
					// For non-manual sections, merge coordinates
					normalizedData.places = normalizedData.places.map(place => {
						const coordData = placesWithCoords.find(p => p.placeId === place.placeId)
						if (coordData) {
							return {
								...place,
								x: coordData.x,
								y: coordData.y,
								row: coordData.row,
								seat: coordData.seat,
								section: coordData.section
							}
						}
						return place
					})
				}
			}

			if (!hasManualSections) {
				normalizedData.layoutAlgorithm = layoutAlgorithm
				normalizedData.coordinateSource = 'pattern_inference'
			}
		}

		// Detect sections if not already set (only for non-manual sections)
		// For manual sections, all places should already have section names from the venue configuration
		if (!hasManualSections) {
			const sections = seatmapAlgorithms.groupPlacesBySection(normalizedData.places)
			normalizedData.places = normalizedData.places.map(place => {
				if (!place.section) {
					const parsed = seatmapAlgorithms.parsePlaceId(place.placeId)
					place.section = parsed.section
				}
				return place
			})
		}

		// Add externalEventId for reference (if provided)
		if (finalEventId) {
			normalizedData.externalEventId = finalEventId
		}

		// Create manifest
		const manifest = new Manifest(normalizedData)
		const savedManifest = await manifest.save()

		return res.status(consts.HTTP_STATUS_OK).json({
			data: savedManifest,
			message: 'Manifest generated successfully'
		})
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Sync manifest to event-merchant-service via S3 and RabbitMQ
 */
export const syncManifestToEventMerchant = async (req, res, next) => {
	try {
		const manifestId = req.params.manifestId

		// Validate manifest exists
		const manifest = await Manifest.findById(manifestId).populate('venue')
		if (!manifest) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Manifest not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Get venue data
		const venue = manifest.venue
		if (!venue) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Venue not found for manifest',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		// Serialize manifest to JSON
		const manifestJson = JSON.stringify(manifest.toObject())
		const manifestSizeBytes = Buffer.byteLength(manifestJson, 'utf8')
		const manifestSizeMB = manifestSizeBytes / (1024 * 1024)

		// Validate size < 5MB
		if (manifestSizeMB > 5) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: `Manifest size ${manifestSizeMB.toFixed(2)}MB exceeds 5MB limit`,
				error: 'MANIFEST_TOO_LARGE'
			})
		}

		// Upload manifest to S3 with fixed key
		const venueId = venue._id.toString()
		const s3Key = await uploadManifestToS3(manifest.toObject(), venueId)
		info(`Manifest uploaded to S3: ${s3Key}`)

		// Generate unique identifiers for the event
		const correlationId = uuidv4()
		const messageId = uuidv4()

		// Create event data
		const eventData = {
			eventType: 'VenueManifestSynced',
			aggregateId: manifest._id.toString(),
			data: {
				venueId: venueId,
				externalVenueId: venue.externalVenueId || null,
				venueName: venue.name || null,
				manifestId: manifest._id.toString(),
				manifestName: manifest.name || null,
				manifestVersion: manifest.version || 1,
				manifestHash: manifest.updateHash || null,
				s3Key: s3Key, // Fixed key, overwrites on update
				operation: 'upsert', // Both create and update use upsert
				syncedAt: new Date()
			},
			metadata: {
				correlationId: correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1,
				source: 'finnep-eventapp-backend'
			}
		}

		// Create outbox message entry
		const outboxMessageData = {
			messageId: messageId,
			exchange: 'event-merchant-exchange',
			routingKey: 'external.venue.manifest.synced', // Follows external.* naming pattern
			messageBody: eventData,
			headers: {
				'content-type': 'application/json',
				'message-type': 'VenueManifestSynced',
				'correlation-id': correlationId,
				'event-version': '1.0'
			},
			correlationId: correlationId,
			eventType: 'VenueManifestSynced',
			aggregateId: manifest._id.toString(),
			status: 'pending',
			exchangeType: 'topic',
			maxRetries: 3,
			attempts: 0
		}

		// Save outbox message for reliability
		const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData)
		info('Outbox message created for manifest sync: %s', outboxMessage._id)

		// Publish to RabbitMQ exchange
		await messageConsumer.publishToExchange(
			outboxMessageData.exchange,
			outboxMessageData.routingKey,
			outboxMessageData.messageBody,
			{
				exchangeType: 'topic',
				publishOptions: {
					correlationId: outboxMessageData.correlationId,
					contentType: 'application/json',
					persistent: true,
					headers: outboxMessageData.headers
				}
			}
		).then(async () => {
			info('Manifest sync event published successfully: %s', outboxMessageData.messageId)

			// Mark outbox message as sent
			await OutboxMessage.markMessageAsSent(outboxMessage._id)
		}).catch(async (publishError) => {
			error('Error publishing manifest sync event:', publishError)

			// Mark outbox message as failed for retry
			await OutboxMessage.markMessageAsFailed(outboxMessage._id, publishError.message)
			throw publishError
		})

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Manifest sync initiated successfully',
			data: {
				manifestId: manifest._id,
				s3Key: s3Key,
				messageId: messageId
			}
		})
	} catch (err) {
		error('Error syncing manifest to event merchant:', err)
		next(err)
	}
}

