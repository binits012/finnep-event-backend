import { EventManifest } from '../../model/mongoModel.js';
import { manifestEncoderService } from './manifestEncoderService.js';
import { downloadPricingFromS3 } from '../../util/aws.js';
import { error, info } from '../../model/logger.js';
import * as Event from '../../model/event.js';
const mongoose = await import('mongoose');
/**
 * Pricing Manifest Sync Service
 * Handles synchronization of pricing configurations from S3 to MongoDB
 * Encodes manifests in Ticketmaster format for efficient storage and updates
 */
export class PricingManifestSyncService {
	/**
	 * Sync pricing manifest from S3 to MongoDB
	 * Downloads enriched pricing from S3, merges with venue manifest, encodes, and stores in MongoDB
	 * @param {string} eventMongoId - MongoDB internal event ID (_id) for direct event association
	 * @param {string} externalEventId - External event ID (for manifest eventId field)
	 * @param {Object} pricingConfig - Pricing configuration object from RabbitMQ message
	 * @param {string} pricingConfig.s3Key - S3 key for pricing file
	 * @param {string} pricingConfig.venueId - Venue ID
	 * @param {string} pricingConfig.pricingConfigurationId - Pricing configuration ID
	 * @returns {Promise<Object>} Created/updated manifest
	 */
	async syncPricingManifest(eventMongoId, externalEventId, pricingConfig) {
		try {
			const { s3Key, venueId, pricingConfigurationId } = pricingConfig;

			if (!s3Key || !venueId) {
				throw new Error('Missing required pricing configuration data: s3Key and venueId are required');
			}

			info(`[PricingManifestSyncService] Starting pricing manifest sync for event ${externalEventId}`, {
				eventMongoId,
				externalEventId,
				s3Key,
				venueId,
				pricingConfigurationId
			});

		// 1. Download complete enriched manifest from S3
		// This contains the full venue structure with pricing already merged into places
		const enrichedManifest = await downloadPricingFromS3(s3Key);

		if (!enrichedManifest) {
			throw new Error('Invalid enriched manifest: manifest data is required');
		}

		if (!enrichedManifest.places || enrichedManifest.places.length === 0) {
			throw new Error('Invalid enriched manifest: places array is required');
		}

		info(`[PricingManifestSyncService] Downloaded enriched manifest from S3`, {
			s3Key,
			placesCount: enrichedManifest.places?.length || 0,
			sectionsCount: enrichedManifest.sections?.length || 0,
			hasBackgroundSvg: !!enrichedManifest.backgroundSvg,
			hasPricingData: !!enrichedManifest.pricingData
		});

		// 2. Extract pricing data for encoding (if available, otherwise derive from places)
		let pricingData = enrichedManifest.pricingData;
		if (!pricingData) {
			console.log('No pricingData in enriched manifest, extracting from places...');
			console.log('Sample places:', enrichedManifest.places?.slice(0, 3)?.map(p => ({
				section: p.section,
				row: p.row,
				seat: p.seat,
				hasPricing: !!p.pricing,
				pricing: p.pricing
			})));
			pricingData = this.extractPricingFromPlaces(enrichedManifest.places);
			console.log('Extracted pricingData:', pricingData);
		}

		// 3. Create manifest structure for encoding (only places needed, venue config stays in Venue collection)
		// NOTE: We do NOT copy sections, backgroundSvg, or other venue configuration to the Manifest
		// The venue manifest configuration remains in the Venue collection and is referenced, not copied
		const fullManifest = {
			venue: enrichedManifest.venue || venueId,
			eventId: String(eventMongoId), // Link to event (internal MongoDB ID as string for association)
			places: enrichedManifest.places // Only places array needed for encoding
		};

		// 4. Encode manifest to Ticketmaster format (minimal: eventId, updateHash, updateTime, placeIds, partitions)
		// Also calculate pricingZones for internal price lookup (stored in EventManifest but not part of Ticketmaster format)
		const encodedManifest = manifestEncoderService.encodeManifest(fullManifest, pricingData);

		// Calculate pricingZones separately for internal price lookup (not part of Ticketmaster format output)
		// This is needed for getPriceForPlaceId to work
		const sortedPlaces = this._sortPlacesForEncoding(enrichedManifest.places);
		const { pricingZones } = manifestEncoderService.calculatePartitions(sortedPlaces, pricingData);

		// Add pricingZones to encodedManifest for storage (not part of Ticketmaster format, but needed internally)
		encodedManifest.pricingZones = pricingZones;

		info(`[PricingManifestSyncService] Manifest encoded (Ticketmaster format)`, {
			placeIdsCount: encodedManifest.placeIds?.length || 0,
			partitionsCount: encodedManifest.partitions?.length || 0,
			eventId: encodedManifest.eventId,
			updateHash: encodedManifest.updateHash
		});

		// 5. Store/update minimal encoded manifest in EventManifest collection (separate from venue Manifest)
		// Full venue configuration (sections, backgroundSvg, places with coordinates) stays in Venue/Manifest collection and is NEVER touched
		const savedManifest = await this.getOrCreateEventManifest(eventMongoId, externalEventId, venueId, encodedManifest, s3Key, pricingConfigurationId, enrichedManifest);

		// 7. Link manifest to event using internal MongoDB ID
		// Use getEventById to directly associate with the event using MongoDB _id
		const existingEvent = await Event.getEventById(eventMongoId);
		if (existingEvent) {
			await Event.updateEventById(existingEvent._id, {
				'venue.lockedManifestId': savedManifest._id,
				'venue.manifestS3Key': s3Key
			});
			info(`[PricingManifestSyncService] Linked manifest to event`, {
				eventMongoId,
				externalEventId,
				manifestId: savedManifest._id,
				s3Key
			});
		} else {
			error(`[PricingManifestSyncService] Event not found for linking manifest`, {
				eventMongoId,
				externalEventId,
				searchMethod: 'getEventById'
			});
		}

			info(`[PricingManifestSyncService] Pricing manifest sync completed successfully`, {
				eventMongoId,
				externalEventId,
				venueId,
				manifestId: savedManifest._id
			});

			return savedManifest;
		} catch (err) {
			error(`[PricingManifestSyncService] Error syncing pricing manifest for event ${externalEventId}:`, {
				error: err.message,
				stack: err.stack,
				eventMongoId,
				externalEventId,
				pricingConfig
			});
			throw err;
		}
	}

	/**
	 * Merge enriched pricing data into venue manifest places
	 * NOTE: This method is deprecated - pricing is now already merged in the enriched manifest from S3
	 * Kept for backward compatibility if needed
	 * @param {Array} venuePlaces - Places array from venue manifest
	 * @param {Object} enrichedPricingData - Enriched pricing data from S3
	 * @returns {Array} Merged places with pricing
	 * @deprecated Pricing is now merged in the enriched manifest from S3
	 */
	mergeEnrichedPricingIntoPlaces(venuePlaces, enrichedPricingData) {
		// Create a map of placeId to pricing for quick lookup
		const pricingMap = new Map();
		if (enrichedPricingData.seats) {
			for (const [placeId, seatPricing] of Object.entries(enrichedPricingData.seats)) {
				pricingMap.set(placeId, seatPricing);
			}
		}

		// Merge pricing into places
		const mergedPlaces = venuePlaces.map(place => {
			const pricing = pricingMap.get(place.placeId);

			if (pricing) {
				// Merge complete pricing structure
				return {
					...place,
					pricing: {
						basePrice: pricing.basePrice || 0,
						tax: pricing.tax !== undefined ? pricing.tax : (pricing.vat !== undefined ? pricing.vat : 0),
						serviceFee: pricing.serviceFee !== undefined ? pricing.serviceFee : 0,
						orderFee: pricing.orderFee !== undefined ? pricing.orderFee : 0,
						currency: pricing.currency || 'EUR',
						// Calculate total price for currentPrice
						currentPrice: (pricing.basePrice || 0) + (pricing.serviceFee || 0) + (pricing.tax !== undefined ? pricing.tax : (pricing.vat !== undefined ? pricing.vat : 0))
					}
				};
			} else {
				// No pricing found - use section pricing or defaults
				let defaultPricing = { basePrice: 0, tax: 0, serviceFee: 0, orderFee: 0, currency: 'EUR' };

				// Try to get section pricing
				if (place.section && enrichedPricingData.sections) {
					const sectionId = place.section;
					const sectionPricing = enrichedPricingData.sections[sectionId];
					if (sectionPricing) {
						defaultPricing = {
							basePrice: sectionPricing.basePrice || 0,
							tax: sectionPricing.tax !== undefined ? sectionPricing.tax : (sectionPricing.vat !== undefined ? sectionPricing.vat : 0),
							serviceFee: sectionPricing.serviceFee || 0,
							orderFee: sectionPricing.orderFee || 0,
							currency: sectionPricing.currency || 'EUR'
						};
					}
				}

				return {
					...place,
					pricing: {
						...defaultPricing,
						currentPrice: defaultPricing.basePrice + defaultPricing.serviceFee + defaultPricing.tax
					}
				};
			}
		});

		return mergedPlaces;
	}


	/**
	 * Get or create event manifest in EventManifest collection (separate from venue Manifest)
	 * Stores minimal Ticketmaster-format encoded manifest (eventId, updateHash, updateTime, placeIds, partitions)
	 * Full venue configuration (sections, backgroundSvg, places with coordinates) remains in Venue/Manifest collection and is NEVER touched
	 * @param {string} eventMongoId - MongoDB internal event ID (_id) for direct event association
	 * @param {string} externalEventId - External event ID (for manifest eventId field)
	 * @param {string} venueId - Venue ID (references Venue collection, not copied)
	 * @param {Object} encodedManifest - Encoded manifest in Ticketmaster format (minimal structure)
	 * @param {string} s3Key - S3 key for pricing (for reference)
	 * @param {string} pricingConfigurationId - Pricing configuration ID (for reference)
	 * @param {Object} enrichedManifest - Enriched manifest with places containing pricing data
	 * @returns {Promise<Object>} Saved event manifest document
	 */
	async getOrCreateEventManifest(eventMongoId, externalEventId, venueId, encodedManifest, s3Key, pricingConfigurationId, enrichedManifest) {
		try {
			// Check if event has existing event manifest
			// Use getEventById to directly get the event using MongoDB _id
			const existingEvent = await Event.getEventById(eventMongoId);
			let existingManifestId = null;

			if (existingEvent && existingEvent.venue && existingEvent.venue.lockedManifestId) {
				existingManifestId = existingEvent.venue.lockedManifestId;
			}

			// Build event manifest document
			// Pricing information is now encoded directly into placeIds via tier codes
			// pricingConfig contains the tier mappings for decoding pricing from placeIds

			// Ticketmaster format fields: eventId, updateHash, updateTime, placeIds, partitions, pricingConfig
			// Pricing information is encoded directly into placeIds via tier codes
			// pricingConfig contains tier mappings for decoding pricing from placeIds
			// Do NOT include sections, backgroundSvg, or places array - these stay in Venue/Manifest collection
			// eventId uses internal MongoDB ID for direct association with Event collection
			const eventManifestData = {
				eventId: String(eventMongoId), // Use internal MongoDB event ID (as string) for association
				venue: venueId, // Reference to Venue collection (not a copy)
				updateHash: encodedManifest.updateHash,
				updateTime: encodedManifest.updateTime,
				placeIds: encodedManifest.placeIds,
				partitions: encodedManifest.partitions,
				pricingConfig: encodedManifest.pricingConfig, // Pricing configuration with tier mappings
				pricingZones: encodedManifest.pricingZones || [], // For internal price lookup
				placeIdMapping: encodedManifest._placeIdMapping || {}, // Original -> encoded placeId mapping
				s3Key: s3Key,
				pricingConfigurationId: pricingConfigurationId
			};

			if (existingManifestId) {
				// Validate that existingManifestId is a valid ObjectId

				if (!mongoose.Types.ObjectId.isValid(existingManifestId)) {
					error(`[PricingManifestSyncService] Invalid manifest ID format: ${existingManifestId}, creating new manifest instead`);
					existingManifestId = null;
				} else {
					// Check if manifest exists in EventManifest collection before trying to update
					// Note: lockedManifestId might point to old Manifest collection, so we need to verify
					const existingManifest = await EventManifest.findById(existingManifestId);
					if (!existingManifest) {
						info(`[PricingManifestSyncService] Manifest ${existingManifestId} not found in EventManifest collection (may be from old Manifest collection), creating new manifest instead`);
						existingManifestId = null;
					} else {
						info(`[PricingManifestSyncService] Found existing EventManifest ${existingManifestId}, will update`);
					}
				}
			}

			if (existingManifestId) {
				// Update existing event manifest (only Ticketmaster format fields)
				const updatedManifest = await EventManifest.findByIdAndUpdate(
					existingManifestId,
					{
						...eventManifestData,
						updatedAt: new Date()
					},
					{ new: true, runValidators: true }
				).catch(updateError => {
					error(`[PricingManifestSyncService] Error updating manifest ${existingManifestId}:`, {
						error: updateError.message,
						stack: updateError.stack
					});
					throw updateError;
				});

				if (!updatedManifest) {
					error(`[PricingManifestSyncService] Manifest ${existingManifestId} update returned null, creating new manifest instead`);
					existingManifestId = null;
				} else {
				info(`[PricingManifestSyncService] Updated existing event manifest (Ticketmaster format)`, {
					manifestId: existingManifestId,
					eventMongoId,
					externalEventId,
					venueId,
					placeIdsCount: eventManifestData.placeIds?.length || 0,
					partitionsCount: eventManifestData.partitions?.length || 0
				});

					return updatedManifest;
				}
			}

			// Create new event manifest (only Ticketmaster format fields)
			// This happens if:
			// 1. No existing manifest ID was found
			// 2. Existing manifest ID was invalid
			// 3. Existing manifest ID points to old Manifest collection (not EventManifest)
			// 4. Update failed and we're creating a new one
			const newEventManifest = new EventManifest(eventManifestData);
			const savedManifest = await newEventManifest.save().catch(saveError => {
				error(`[PricingManifestSyncService] Error saving new manifest:`, {
					error: saveError.message,
					stack: saveError.stack,
					eventManifestData: {
						eventId: eventManifestData.eventId,
						venueId: eventManifestData.venue,
						placeIdsCount: eventManifestData.placeIds?.length || 0,
						partitionsCount: eventManifestData.partitions?.length || 0
					}
				});
				throw saveError;
			});

			info(`[PricingManifestSyncService] Created new event manifest (Ticketmaster format)`, {
				manifestId: savedManifest._id,
				eventMongoId,
				externalEventId,
				venueId,
				placeIdsCount: eventManifestData.placeIds?.length || 0,
				partitionsCount: eventManifestData.partitions?.length || 0,
				replacedOldManifestId: existingManifestId || 'none'
			});

			// Update event with new manifest ID (always update to point to EventManifest)
			if (existingEvent) {
				await Event.updateEventById(existingEvent._id, {
					'venue.lockedManifestId': savedManifest._id
				}).catch(updateError => {
					error(`[PricingManifestSyncService] Failed to update event with manifest ID:`, {
						error: updateError.message,
						eventId: existingEvent._id,
						manifestId: savedManifest._id
					});
					// Don't throw - manifest is saved, event update is secondary
				});
			}

			return savedManifest;
		} catch (err) {
			error(`[PricingManifestSyncService] Error getting/creating event manifest:`, {
				error: err.message,
				stack: err.stack,
				eventMongoId,
				externalEventId,
				venueId
			});
			throw err;
		}
	}

	/**
	 * Extract pricing data from places array (fallback when pricingData not available)
	 * @param {Array} places - Array of places with pricing data
	 * @returns {Object} Pricing configuration object
	 */
	extractPricingFromPlaces(places) {
		try {
			if (!places || places.length === 0) {
				throw new Error('No places available for pricing extraction');
			}

			// Find places with pricing data
			const placesWithPricing = places.filter(place => place.pricing);
			if (placesWithPricing.length === 0) {
				throw new Error('No places with pricing data found');
			}

			info(`[PricingManifestSyncService] Extracting pricing from ${placesWithPricing.length} places`);

			// Group by pricing (basePrice, tax, serviceFee, serviceTax)
			const pricingGroups = new Map();

			placesWithPricing.forEach(place => {
				const pricing = place.pricing;
				console.log(`Place ${place.section}-${place.row}-${place.seat} pricing:`, pricing);
				const key = `${pricing.basePrice}-${pricing.tax}-${pricing.serviceFee}-${pricing.serviceTax}`;

				if (!pricingGroups.has(key)) {
					pricingGroups.set(key, {
						basePrice: pricing.basePrice,
						tax: pricing.tax,
						serviceFee: pricing.serviceFee,
						serviceTax: pricing.serviceTax,
						count: 0
					});
				}
				pricingGroups.get(key).count++;
			});
			console.log('Pricing groups:', Array.from(pricingGroups.entries()));

			// Convert to tiers array (use index as tier ID)
			const tiers = Array.from(pricingGroups.values()).map((group, index) => ({
				id: String(index), // Tier ID as string (0, 1, 2, etc.)
				basePrice: group.basePrice,
				tax: group.tax,
				serviceFee: group.serviceFee,
				serviceTax: group.serviceTax
			}));

			// Extract currency from first place
			const currency = placesWithPricing[0]?.pricing?.currency || 'EUR';

			// Extract order fee from first place (assuming same for all)
			const orderFee = placesWithPricing[0]?.pricing?.orderFee || 0;

			const pricingConfig = {
				currency,
				orderFee,
				orderTax: 0, // Default to 0
				tiers
			};

			info(`[PricingManifestSyncService] Extracted pricing config:`, {
				currency,
				orderFee,
				tiersCount: tiers.length,
				sampleTier: tiers[0]
			});

			return pricingConfig;
		} catch (err) {
			error(`[PricingManifestSyncService] Error extracting pricing from places:`, err.message);
			throw err;
		}
	}

	/**
	 * Sort places by section → row → seat (helper method for encoding)
	 * @private
	 * @param {Array} places - Array of places
	 * @returns {Array} Sorted array of places
	 */
	_sortPlacesForEncoding(places) {
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
}

// Export singleton instance
export const pricingManifestSyncService = new PricingManifestSyncService();
export default pricingManifestSyncService;

