import { Manifest, Event, Venue } from '../../model/mongoModel.js';
import { manifestEncoderService } from './manifestEncoderService.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { error, info } from '../../model/logger.js';

dotenv.config();

const s3Client = new S3Client({
	bucket: process.env.BUCKET_NAME,
	region: process.env.BUCKET_REGION,
	credentials: {
		accessKeyId: process.env.BUCKET_ACCESS_CLIENT,
		secretAccessKey: process.env.BUCKET_ACCESS_KEY,
	}
});

/**
 * Manifest Lock Service
 * Locks a manifest for an event when the event is activated
 * Creates encoded manifest and uploads to S3
 */
export class ManifestLockService {
	/**
	 * Lock manifest for an event
	 * @param {string} eventId - MongoDB Event ID
	 * @param {string} venueId - MongoDB Venue ID
	 * @param {Object} pricingConfig - Pricing configuration (Map or object)
	 * @returns {Promise<Object>} Locked manifest
	 */
	async lockManifestForEvent(eventId, venueId, pricingConfig = {}) {
		try {
			info(`Locking manifest for event ${eventId}, venue ${venueId}`);

			// 1. Get venue manifest from MongoDB (master copy)
			// This is the source of truth for venue configuration
			const { Venue, Manifest } = await import('../../model/mongoModel.js');
			const venue = await Venue.findById(venueId);
			if (!venue) {
				throw new Error(`Venue not found: ${venueId}`);
			}

			// 2. Get manifest from MongoDB (venue configuration with places, sections, backgroundSvg)
			const venueManifest = await Manifest.findOne({ venue: venueId }).sort({ createdAt: -1 });
			if (!venueManifest) {
				throw new Error(`Manifest not found for venue ${venueId}`);
			}

			// Convert to plain object for encoding
			const fullManifest = {
				venue: venueId,
				places: venueManifest.places || [],
				sections: venueManifest.sections || [],
				backgroundSvg: venueManifest.backgroundSvg || null,
				name: venueManifest.name,
				version: venueManifest.version
			};

			// 3. Apply merchant pricing config to places
			// Pricing config is applied during encoding

			// 4. Encode manifest (Ticketmaster format)
			const encodedManifest = manifestEncoderService.encodeManifest(fullManifest, pricingConfig);

			// 5. Set eventId and isLocked flag
			encodedManifest.eventId = eventId;
			encodedManifest.isLocked = true;

			// 6. Upload encoded manifest to S3: manifests/{venueId}/events/{eventId}/manifest.json
			const s3Key = `manifests/${venueId}/events/${eventId}/manifest.json`;
			const manifestJson = JSON.stringify(encodedManifest);
			const manifestSizeBytes = Buffer.byteLength(manifestJson, 'utf8');
			const manifestSizeMB = manifestSizeBytes / (1024 * 1024);

			if (manifestSizeMB > 5) {
				throw new Error(`Encoded manifest size ${manifestSizeMB.toFixed(2)}MB exceeds 5MB limit`);
			}

			// Upload to S3
			await s3Client.send(
				new PutObjectCommand({
					Bucket: process.env.BUCKET_NAME,
					Key: s3Key,
					ContentType: 'application/json',
					Body: manifestJson
				})
			);
			info(`Locked manifest uploaded to S3: ${s3Key} (${manifestSizeMB.toFixed(2)}MB)`);

			// 7. Save encoded manifest to MongoDB
			const manifest = new Manifest(encodedManifest);
			const savedManifest = await manifest.save();

			info(`Manifest locked and saved: ${savedManifest._id}`);

			// 8. Return locked manifest with S3 key
			return {
				manifest: savedManifest,
				s3Key: s3Key,
				manifestId: savedManifest._id
			};
		} catch (err) {
			error(`Error locking manifest for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Get locked manifest for an event
	 * @param {string} eventId - MongoDB Event ID
	 * @returns {Promise<Object|null>} Locked manifest or null
	 */
	async getLockedManifest(eventId) {
		try {
			const manifest = await Manifest.findOne({
				eventId: eventId,
				isLocked: true,
				encodedFormat: true
			});

			return manifest;
		} catch (err) {
			error(`Error getting locked manifest for event ${eventId}:`, err);
			throw err;
		}
	}

	/**
	 * Check if manifest is locked for an event
	 * @param {string} eventId - MongoDB Event ID
	 * @returns {Promise<boolean>} True if manifest is locked
	 */
	async isManifestLocked(eventId) {
		try {
			const manifest = await Manifest.findOne({
				eventId: eventId,
				isLocked: true
			});

			return manifest !== null;
		} catch (err) {
			error(`Error checking if manifest is locked for event ${eventId}:`, err);
			throw err;
		}
	}

}

// Export singleton instance
export const manifestLockService = new ManifestLockService();
export default manifestLockService;

