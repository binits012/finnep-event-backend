import { inboxModel } from '../../model/inboxMessage.js';
import { EventManifest, Manifest, Event } from '../../model/mongoModel.js';
import { seatReservationService } from '../../src/services/seatReservationService.js';
import { messageConsumer } from '../services/messageConsumer.js';
import { v4 as uuidv4 } from 'uuid';
import { error, info } from '../../model/logger.js';
import { createOutboxMessage, markMessageAsSent, markMessageAsFailed } from '../../model/outboxMessage.js';
import { ManifestEncoderService } from '../../src/services/manifestEncoderService.js';

/**
 * Base64 URL-safe decode
 * @param {string} str - Base64URL encoded string
 * @returns {string} Decoded string
 */
function base64UrlDecode(str) {
    try {
        // Add padding if needed
        let paddedStr = str.replace(/-/g, '+').replace(/_/g, '/');
        while (paddedStr.length % 4 !== 0) {
            paddedStr += '=';
        }
        return Buffer.from(paddedStr, 'base64').toString('utf8');
    } catch (err) {
        console.error('Error decoding base64:', err);
        return str; // Return original if decoding fails
    }
}

/**
 * Decode position code (row, seat, x, y) from base36 encoded string
 * @param {string} positionCode - Base36 encoded position data
 * @returns {Object|null} Decoded position data
 */
function decodePosition(positionCode) {
    try {
        if (!positionCode || positionCode.length < 6) {
            return null;
        }

        // Convert base36 to number
        const combinedValue = parseInt(positionCode, 36);
        if (isNaN(combinedValue)) {
            return null;
        }

        // Extract components using division and bitwise operations
        // row: bits 48-63, seat: bits 32-47, x: bits 16-31, y: bits 0-15
        const row16 = Math.floor(combinedValue / Math.pow(2, 48)) & 0xFFFF;
        const seat16 = Math.floor(combinedValue / Math.pow(2, 32)) & 0xFFFF;
        const x16 = Math.floor(combinedValue / Math.pow(2, 16)) & 0xFFFF;
        const y16 = combinedValue & 0xFFFF;

        return {
            row: row16,
            seat: seat16,
            x: x16,
            y: y16
        };
    } catch (err) {
        console.error('Error decoding position:', err);
        return null;
    }
}

/**
 * Decode placeId back to position data
 * @param {string} placeId - Encoded place ID
 * @returns {Object|null} Decoded data or null if invalid
 */
function decodePlaceId(placeId) {
    try {
        if (!placeId || typeof placeId !== 'string') {
            return null;
        }

        // Check if new format (with | separators) or old format
        if (placeId.includes('|')) {
            const parts = placeId.split('|');

            // New format with available and tags: VENUE_PREFIX + SECTION_B64 + "|" + TIER_CODE + "|" + POSITION_CODE + "|" + AVAILABLE_FLAG + "|" + TAGS_CODE
            if (parts.length === 5) {
                const sectionB64 = parts[0].substring(4);
                const tierCode = parts[1];
                const positionCode = parts[2];
                const availableFlag = parts[3];
                const tagsCode = parts[4];

                const section = base64UrlDecode(sectionB64);
                const position = decodePosition(positionCode);
                if (!position) {
                    return null;
                }

                const available = availableFlag === '1';
                const tags = tagsCode ? base64UrlDecode(tagsCode).split(',').filter(Boolean) : [];

                return {
                    section: section,
                    tierCode: tierCode,
                    row: position.row,
                    seat: position.seat,
                    x: position.x,
                    y: position.y,
                    available: available,
                    tags: tags
                };
            }
            // Legacy format: VENUE_PREFIX + SECTION_B64 + "|" + TIER_CODE + "|" + POSITION_CODE
            else if (parts.length === 3) {
                const sectionB64 = parts[0].substring(4);
                const tierCode = parts[1];
                const positionCode = parts[2];

                const section = base64UrlDecode(sectionB64);
                const position = decodePosition(positionCode);
                if (!position) {
                    return null;
                }

                return {
                    section: section,
                    tierCode: tierCode,
                    row: position.row,
                    seat: position.seat,
                    x: position.x,
                    y: position.y,
                    available: true,
                    tags: []
                };
            } else {
                return null;
            }
        } else {
            // Old format: VENUE_PREFIX + TIER_CODE + SECTION_CHAR + POSITION_CODE
            if (placeId.length < 12) {
                return null;
            }
            const venuePrefix = placeId.substring(0, 4);
            const tierCode = placeId.substring(4, 5);
            const sectionChar = placeId.substring(5, 6);
            const positionCode = placeId.substring(6);

            const position = decodePosition(positionCode);
            if (!position) {
                return null;
            }

            return {
                section: sectionChar,
                tierCode: tierCode,
                row: position.row,
                seat: position.seat,
                x: position.x,
                y: position.y,
                available: true,
                tags: []
            };
        }
    } catch (err) {
        console.error(`Error decoding placeId ${placeId}:`, err);
        return null;
    }
}

/**
 * Handle seat availability check request from event-merchant-service
 * @param {Object} message - The message from RabbitMQ
 */
export const handleSeatAvailabilityCheck = async (message) => {
    info('Processing seat availability check request', {
        messageType: typeof message,
        messageKeys: message ? Object.keys(message) : [],
        eventType: message?.eventType,
        routingKey: message?.routingKey,
        fullMessage: message
    });

    // Validate message structure
    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object: %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metadata?.causationId || message?.messageId || message?.data?.messageId;
    const correlationId = message?.metadata?.correlationId;

    // Check if message has already been processed (idempotency)
    if (messageId) {
        const isProcessed = await inboxModel.isProcessed(messageId);
        if (isProcessed) {
            info(`Message ${messageId} already processed, skipping...`);
            return;
        }
    }

    // Try to save message to inbox, but handle duplicate key error gracefully
    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.eventType || message.type || message.routingKey,
            aggregateId: message.aggregateId || message.data?.eventId,
            data: message,
            metadata: message?.metadata || message?.metaData || { receivedAt: new Date() }
        });
    } catch (saveError) {
        // If it's a duplicate key error, check if the message was already processed
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await inboxModel.isProcessed(messageId);
            if (isAlreadyProcessed) {
                info(`Message ${messageId} already processed, skipping...`);
                return;
            }
        }
        // Re-throw if it's not a duplicate key error or message wasn't processed
        throw saveError;
    }

    try {
        // Extract data from message
        const { eventType, aggregateId, data, metadata } = message;

        // Validate required fields
        if (!data?.eventId || !data?.merchantId || !data?.placeIds) {
            throw new Error('Invalid seat availability check request: missing eventId, merchantId, or placeIds');
        }

        const { eventId, merchantId, placeIds } = data;

        info('Checking seat availability', {
            eventId,
            merchantId,
            placeIdsCount: placeIds.length
        });

        // Get event manifest to check sold seats
        const event = await Event.findOne({externalEventId: eventId, externalMerchantId: merchantId });
        if (!event) {
            throw new Error(`Event not found for eventId ${eventId}, merchantId ${merchantId}`);
        }

        const encodedManifest = await EventManifest.findOne({ eventId: event._id }).populate('venue');
        if (!encodedManifest) {
            throw new Error(`Event manifest not found for event ${eventId}`);
        }

        // Get venue manifest (full manifest with places array)
        const venueManifest = await Manifest.findOne({ venue: encodedManifest.venue._id })
            .sort({ createdAt: -1 });
        if (!venueManifest || !venueManifest.places) {
            throw new Error(`Venue manifest not found for venue ${encodedManifest.venue._id}`);
        }

        // Create a map of placeId to place data for quick lookup
        const placeMap = new Map();
        const placeIdMapping = encodedManifest._placeIdMapping || encodedManifest.placeIdMapping || {};

        info('PlaceIdMapping check', {
            hasPlaceIdMapping: !!encodedManifest._placeIdMapping || !!encodedManifest.placeIdMapping,
            mappingKeysCount: Object.keys(placeIdMapping).length,
            mappingSample: Object.entries(placeIdMapping).slice(0, 3)
        });

        venueManifest.places.forEach(place => {
            // Store by both original placeId and encoded placeId if different
            const originalPlaceId = String(place.placeId);
            placeMap.set(originalPlaceId, place);

            const encodedPlaceId = placeIdMapping[originalPlaceId];
            if (encodedPlaceId) {
                placeMap.set(encodedPlaceId, place);
            }

            // Also try to match by section-row-seat combination
            if (place.section && place.row !== null && place.row !== undefined && place.seat !== null && place.seat !== undefined) {
                const locationKey = `${place.section}|${place.row}|${place.seat}`;
                placeMap.set(locationKey, place);
            }
        });

        // Create tier map for pricing lookup
        const tierMap = new Map();
        if (encodedManifest.pricingConfig && encodedManifest.pricingConfig.tiers) {
            encodedManifest.pricingConfig.tiers.forEach(tier => {
                tierMap.set(tier.id, tier);
            });
        }

        const soldPlaceIds = encodedManifest.availability?.sold || [];
        const soldSeatsSet = new Set(soldPlaceIds);
        const soldSeatsByLocation = new Map();
        soldPlaceIds.forEach(encodedPlaceId => {
            const decoded = decodePlaceId(encodedPlaceId);
            if (decoded && decoded.section && decoded.row !== null && decoded.seat !== null) {
                // Create normalized location key: "section|row|seat"
                const locationKey = `${decoded.section}|${decoded.row}|${decoded.seat}`;
                soldSeatsByLocation.set(locationKey, encodedPlaceId);
            }
        });

        // Get reserved seats from Redis
        const reservedMap = await seatReservationService.getReservedSeats(eventId);
        const reservedSeats = new Set(reservedMap.keys());

        info('Seat availability check - sold seats info', {
            soldPlaceIdsCount: soldPlaceIds.length,
            soldPlaceIdsSample: soldPlaceIds.slice(0, 5),
            requestedPlaceIdsSample: placeIds.slice(0, 5),
            soldSeatsByLocationCount: soldSeatsByLocation.size,
            venuePlacesCount: venueManifest.places.length
        });

        /**
         * Get enriched seat data for a placeId
         * @param {string} placeIdStr - Place ID string
         * @returns {Object|null} Enriched seat data or null if not found
         */
        const getEnrichedSeatData = (placeIdStr) => {
            let tierCode = null;
            let extractedFromEncoded = false;

            if (placeIdStr.includes('|')) {
                const parts = placeIdStr.split('|');
                // Handle both new format (5 parts) and legacy format (3 parts)
                if (parts.length === 5 || parts.length === 3) {
                    tierCode = parts[1];
                    extractedFromEncoded = true;
                }
            }

            // Try to find place by direct placeId match
            let place = placeMap.get(placeIdStr);

            // If not found, try decoding and matching by location
            if (!place) {
                const decoded = decodePlaceId(placeIdStr);
                if (decoded && decoded.section && decoded.row !== null && decoded.seat !== null) {
                    const locationKey = `${decoded.section}|${decoded.row}|${decoded.seat}`;
                    place = placeMap.get(locationKey);

                    // If still not found, try to find by matching section/row/seat in venue manifest
                    if (!place) {
                        place = venueManifest.places.find(p =>
                            p.section === decoded.section &&
                            String(p.row) === String(decoded.row) &&
                            String(p.seat) === String(decoded.seat)
                        );
                    }
                }
            }

            if (!place) {
                return null;
            }

            // Get pricing from tier or place pricing
            let pricing = {
                basePrice: 0,
                currency: 'EUR',
                serviceFee: 0,
                tax: 0,
                serviceTax: 0,
                orderFee: 0
            };

            // Try to get pricing from EventManifest pricingConfig (tier-based)
            if (encodedManifest.pricingConfig) {

                // If we already extracted tierCode from encoded placeId, use it
                if (!extractedFromEncoded && tierCode === null) {
                    if (placeIdStr.length >= 6) {
                        tierCode = placeIdStr.substring(4, 5);
                    }
                }

                if (tierCode !== null) {
                    const tier = tierMap.get(tierCode);
                    if (tier) {
                        pricing = {
                            basePrice: tier.basePrice || 0,
                            currency: encodedManifest.pricingConfig.currency || 'EUR',
                            serviceFee: tier.serviceFee || 0,
                            tax: tier.tax || 0,
                            serviceTax: tier.serviceTax || 0,
                            orderFee: encodedManifest.pricingConfig.orderFee || 0
                        };
                    }
                }
            } else {
                // Fallback to place pricing if available
                if (place.pricing && (pricing.basePrice === 0 || !encodedManifest.pricingConfig)) {
                    pricing = {
                        basePrice: place.pricing.basePrice || place.pricing.currentPrice || 0,
                        currency: place.pricing.currency || 'EUR',
                        serviceFee: 0,
                        tax: 0,
                        serviceTax: 0,
                        orderFee: 0
                    };
                }
            }

            // Build ticket name
            let ticketName = '';
            if (place.section && place.row !== null && place.seat !== null) {
                ticketName = `Section: ${place.section}, Row: ${place.row}, Seat: ${place.seat}`;
            } else if (place.ticketName || place.name) {
                ticketName = place.ticketName || place.name;
            } else {
                ticketName = `Seat ${placeIdStr}`;
            }

            // Encode placeId from venue manifest place data
            let finalPlaceId = placeIdStr;

            // If request was already encoded, use it
            if (placeIdStr.includes('|')) {
                finalPlaceId = placeIdStr;
            } else {
                // Try mapping first
                const originalPlaceIdKey = String(place.placeId);
                const mappedEncodedPlaceId = placeIdMapping[originalPlaceIdKey];

                if (mappedEncodedPlaceId && encodedManifest.placeIds.includes(mappedEncodedPlaceId)) {
                    finalPlaceId = mappedEncodedPlaceId;
                } else {
                    // Encode the place and verify it exists in placeIds
                    const encoder = new ManifestEncoderService();
                    const venueId = encodedManifest.venue?._id || encodedManifest.venue;

                    // Use tierCode we already found, or find it from place pricing
                    let encodingTierCode = tierCode || '0';

                    if (!tierCode && encodedManifest.pricingConfig && encodedManifest.pricingConfig.tiers && place.pricing) {
                        const matchingTier = encodedManifest.pricingConfig.tiers.find(tier => {
                            return tier.basePrice === (place.pricing.basePrice || place.pricing.currentPrice || 0) &&
                                   tier.tax === (place.pricing.tax || 0) &&
                                   tier.serviceFee === (place.pricing.serviceFee || 0) &&
                                   tier.serviceTax === (place.pricing.serviceTax || 0);
                        });

                        if (matchingTier) {
                            encodingTierCode = matchingTier.id;
                        }
                    }

                    // Encode the place
                    const venuePrefix = encoder._generateVenuePrefix(venueId);
                    const sectionB64 = encoder._base64UrlEncode(place.section || '');
                    const positionCode = encoder._encodePosition(place.row || '', place.seat || '', place.x || 0, place.y || 0);
                    const available = place.available !== false ? '1' : '0';
                    const tags = place.tags || [];
                    const tagsStr = tags.length > 0 ? tags.join(',') : '';
                    const tagsCode = tagsStr ? encoder._base64UrlEncode(tagsStr) : '';
                    const encodedPlaceId = `${venuePrefix}${sectionB64}|${encodingTierCode}|${positionCode}|${available}|${tagsCode}`;

                    // Verify it exists in placeIds (check both new format and legacy format for backward compatibility)
                    if (encodedManifest.placeIds.includes(encodedPlaceId)) {
                        finalPlaceId = encodedPlaceId;
                    } else {
                        // Try legacy format (3 parts) for backward compatibility
                        const legacyEncodedPlaceId = `${venuePrefix}${sectionB64}|${encodingTierCode}|${positionCode}`;
                        if (encodedManifest.placeIds.includes(legacyEncodedPlaceId)) {
                            finalPlaceId = legacyEncodedPlaceId;
                        }
                    }
                }
            }

            // Extract available and tags from decoded placeId or use from place object
            let available = place.available !== false;
            let tags = place.tags || [];

            // If finalPlaceId is in new format, decode it to get available and tags
            if (finalPlaceId && finalPlaceId.includes('|')) {
                const decoded = decodePlaceId(finalPlaceId);
                if (decoded && decoded.available !== undefined) {
                    available = decoded.available;
                }
                if (decoded && decoded.tags) {
                    tags = decoded.tags;
                }
            }

            // Check if seat is wheelchair accessible
            const wheelchairAccessible = tags.includes('wheelchair') || place.tags?.includes('wheelchair') || false;

            return {
                placeId: finalPlaceId, // Use encoded placeId if available, otherwise requested placeId
                originalPlaceId: String(place.placeId), // Original placeId from venue manifest
                section: place.section || null,
                row: place.row !== null && place.row !== undefined ? String(place.row) : null,
                seat: place.seat !== null && place.seat !== undefined ? String(place.seat) : null,
                pricing: pricing,
                ticketName: ticketName,
                available: available,
                tags: tags,
                wheelchairAccessible: wheelchairAccessible
            };
        };

        // Check each requested placeId and build enriched availability data
        const availability = {
            available: [],
            sold: [],
            reserved: []
        };

        placeIds.forEach(placeId => {
            const placeIdStr = String(placeId);
            const enrichedSeat = getEnrichedSeatData(placeIdStr);

            // If we can't find the seat data, still check availability but log a warning
            if (!enrichedSeat) {
                info('Warning: Could not enrich seat data for placeId', { placeId: placeIdStr });
            }

            // Get the encoded placeId mapping if we have seat data
            const encodedFromMapping = enrichedSeat ? placeIdMapping[enrichedSeat.originalPlaceId] : null;

            // Strategy 1: Direct comparison with encoded placeIds
            // Check both requested placeId and its mapped encoded version
            const placeIdsToCheck = [placeIdStr];
            if (encodedFromMapping) {
                placeIdsToCheck.push(encodedFromMapping);
            }

            for (const checkPlaceId of placeIdsToCheck) {
                if (soldSeatsSet.has(checkPlaceId)) {
                    availability.sold.push(enrichedSeat || { placeId: placeIdStr });
                    info('Seat found as sold (direct encoded match)', { requestedPlaceId: placeIdStr, matchedPlaceId: checkPlaceId });
                    return;
                }
            }

            // Strategy 2: Check reserved seats
            // Check both requested placeId and its mapped encoded version
            const reservedPlaceIdsToCheck = [placeIdStr];
            if (encodedFromMapping) {
                reservedPlaceIdsToCheck.push(encodedFromMapping);
            }

            for (const checkPlaceId of reservedPlaceIdsToCheck) {
                if (reservedSeats.has(checkPlaceId)) {
                    availability.reserved.push(enrichedSeat || { placeId: placeIdStr });
                    info('Seat found as reserved', { requestedPlaceId: placeIdStr, matchedPlaceId: checkPlaceId });
                    return;
                }
            }

            // Strategy 3: Fallback - decode both and compare by location (section/row/seat)
            const decodedRequested = decodePlaceId(placeIdStr);
            if (decodedRequested && decodedRequested.section && decodedRequested.row !== null && decodedRequested.seat !== null) {
                const locationKey = `${decodedRequested.section}|${decodedRequested.row}|${decodedRequested.seat}`;
                if (soldSeatsByLocation.has(locationKey)) {
                    const soldPlaceId = soldSeatsByLocation.get(locationKey);
                    availability.sold.push(enrichedSeat || { placeId: placeIdStr });
                    info('Seat found as sold (location match)', {
                        requestedPlaceId: placeIdStr,
                        soldPlaceId: soldPlaceId,
                        locationKey: locationKey,
                        decoded: decodedRequested
                    });
                    return;
                }
            }

            // Strategy 4: Check if seat is marked as unavailable (available: false)
            // If seat is not available, mark it as sold
            if (enrichedSeat && enrichedSeat.available === false) {
                availability.sold.push(enrichedSeat);
                info('Seat marked as sold (not available)', {
                    requestedPlaceId: placeIdStr,
                    placeId: enrichedSeat.placeId
                });
                return;
            }

            // If none of the strategies found it as sold or reserved, it's available
            availability.available.push(enrichedSeat || { placeId: placeIdStr });
        });

        const allAvailable = availability.sold.length === 0 && availability.reserved.length === 0;

        info('Seat availability check completed', {
            eventId,
            merchantId,
            totalRequested: placeIds.length,
            available: availability.available.length,
            sold: availability.sold.length,
            reserved: availability.reserved.length,
            allAvailable
        });

        // Create response message
        const responseMessageId = uuidv4();
        const responseData = {
            eventType: 'SeatAvailabilityCheckResponse',
            aggregateId: eventId,
            data: {
                eventId: eventId,
                merchantId: merchantId,
                availability: availability,
                allAvailable: allAvailable,
                respondedAt: new Date().toISOString()
            },
            metadata: {
                correlationId: correlationId, // Echo back request correlationId
                causationId: responseMessageId,
                timestamp: new Date().toISOString(),
                version: 1,
                source: 'finnep-eventapp-backend'
            }
        };

        // Create outbox message entry for reliability
        const outboxMessageData = {
            messageId: responseMessageId,
            exchange: 'event-merchant-exchange',
            routingKey: 'external.seat.availability.check.response',
            messageBody: responseData,
            headers: {
                'content-type': 'application/json',
                'message-type': 'SeatAvailabilityCheckResponse',
                'correlation-id': correlationId,
                'event-version': '1.0'
            },
            correlationId: correlationId,
            eventType: 'SeatAvailabilityCheckResponse',
            aggregateId: eventId,
            status: 'pending',
            exchangeType: 'topic',
            maxRetries: 3,
            attempts: 0
        };

        // Save outbox message for reliability
        const outboxMessage = await createOutboxMessage(outboxMessageData);
        info('Outbox message created for seat availability check response:', outboxMessage._id);

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
            info('Seat availability check response published successfully:', outboxMessageData.messageId);
            // Mark outbox message as sent
            await markMessageAsSent(outboxMessage._id);
        }).catch(async (publishError) => {
            error('Error publishing seat availability check response:', publishError);
            // Mark outbox message as failed for retry
            await markMessageAsFailed(outboxMessage._id, publishError.message);
            throw publishError;
        });

        info(`Published seat availability check response to exchange: ${outboxMessageData.exchange}`);

    } catch (err) {
        error('Error handling seat availability check request: %s', err.stack);
        throw err;
    }
};

