import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Import models after connection
import '../model/dbConnect.js';
import * as mongoModel from '../model/mongoModel.js';
import { info, error, warn } from '../model/logger.js';

/**
 * Migration script for MongoDB schema changes
 * Run with: node scripts/migrate-schemas.js
 */

const MIGRATION_VERSION = '2025-12-24-001';

async function waitForConnection() {
    let retries = 0;
    const maxRetries = 30;

    while (mongoose.connection.readyState !== 1 && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries++;
    }

    if (mongoose.connection.readyState !== 1) {
        throw new Error('Failed to connect to MongoDB');
    }

    info('Connected to MongoDB');
}

async function migrateMerchantOtherInfo() {
    info('Starting migration: Merchant otherInfo field');

    try {
        const Merchant = mongoModel.Merchant;
        // Use lean() to get plain objects and avoid validation issues
        const merchants = await Merchant.find({}).lean();

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const merchant of merchants) {
            try {
                let needsUpdate = false;
                let otherInfoValue = null;

                // Check if otherInfo doesn't exist or is null/undefined
                if (!merchant.otherInfo) {
                    // Initialize as empty Map (Mongoose will handle conversion)
                    otherInfoValue = {};
                    needsUpdate = true;
                } else {
                    // Check if it's a plain object (not a Mongoose Map)
                    // When using lean(), Maps come back as objects
                    const isPlainObject = merchant.otherInfo.constructor === Object ||
                                         (typeof merchant.otherInfo === 'object' &&
                                          merchant.otherInfo !== null &&
                                          !merchant.otherInfo.get &&
                                          !merchant.otherInfo.set);

                    if (isPlainObject) {
                        // Keep as object - Mongoose will convert to Map on save
                        otherInfoValue = merchant.otherInfo;
                        needsUpdate = true;
                    }
                }

                if (needsUpdate) {
                    // Use updateOne to avoid full document validation
                    // This only updates the otherInfo field
                    await Merchant.updateOne(
                        { _id: merchant._id },
                        { $set: { otherInfo: otherInfoValue || {} } },
                        { runValidators: false } // Skip validation to avoid required field errors
                    );
                    updated++;
                    info(`Migrated otherInfo for merchant: ${merchant.merchantId}`);
                } else {
                    skipped++;
                }
            } catch (merchantErr) {
                errors++;
                error(`Error migrating merchant ${merchant.merchantId}: ${merchantErr.message}`);
                // Continue with next merchant instead of failing entire migration
            }
        }

        info(`Merchant otherInfo migration completed: ${updated} updated, ${skipped} skipped, ${errors} errors`);
        return { updated, skipped, errors };
    } catch (err) {
        error('Error migrating Merchant otherInfo:', err);
        throw err;
    }
}

async function migrateSettingOtherInfo() {
    info('Starting migration: Setting otherInfo field');

    try {
        const Setting = mongoModel.Setting;
        // Use lean() to get plain objects and avoid validation issues
        const settings = await Setting.find({}).lean();

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const setting of settings) {
            try {
                let needsUpdate = false;
                let otherInfoValue = null;

                // Check if otherInfo doesn't exist or is null/undefined
                if (!setting.otherInfo) {
                    // Initialize as empty object (Mongoose will handle conversion to Map)
                    otherInfoValue = {};
                    needsUpdate = true;
                } else {
                    // Check if it's a plain object (not a Mongoose Map)
                    // When using lean(), Maps come back as objects
                    const isPlainObject = setting.otherInfo.constructor === Object ||
                                         (typeof setting.otherInfo === 'object' &&
                                          setting.otherInfo !== null &&
                                          !setting.otherInfo.get &&
                                          !setting.otherInfo.set);

                    if (isPlainObject) {
                        // Keep as object - Mongoose will convert to Map on save
                        otherInfoValue = setting.otherInfo;
                        needsUpdate = true;
                    }
                }

                if (needsUpdate) {
                    // Use updateOne to avoid full document validation
                    // This only updates the otherInfo field
                    await Setting.updateOne(
                        { _id: setting._id },
                        { $set: { otherInfo: otherInfoValue || {} } },
                        { runValidators: false } // Skip validation
                    );
                    updated++;
                    info(`Migrated otherInfo for setting: ${setting._id}`);
                } else {
                    skipped++;
                }
            } catch (settingErr) {
                errors++;
                error(`Error migrating setting ${setting._id}: ${settingErr.message}`);
                // Continue with next setting instead of failing entire migration
            }
        }

        info(`Setting otherInfo migration completed: ${updated} updated, ${skipped} skipped, ${errors} errors`);
        return { updated, skipped, errors };
    } catch (err) {
        error('Error migrating Setting otherInfo:', err);
        throw err;
    }
}

async function migrateTicketOtpUniqueIndex() {
    info('Starting migration: Ticket OTP unique index');

    try {
        const Ticket = mongoModel.Ticket;

        // First, check for duplicate OTPs
        info('Checking for duplicate OTPs...');
        const duplicateOtps = await Ticket.aggregate([
            {
                $match: {
                    otp: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: '$otp',
                    count: { $sum: 1 },
                    ticketIds: { $push: '$_id' }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]);

        if (duplicateOtps.length > 0) {
            warn(`Found ${duplicateOtps.length} duplicate OTP(s). This must be resolved before creating unique index.`);
            warn('Duplicate OTPs:');
            duplicateOtps.forEach(dup => {
                warn(`  OTP: ${dup._id}, Count: ${dup.count}, Ticket IDs: ${dup.ticketIds.join(', ')}`);
            });
            throw new Error(`Cannot create unique index: Found ${duplicateOtps.length} duplicate OTP(s). Please resolve duplicates first.`);
        }

        info('No duplicate OTPs found. Proceeding with index creation...');

        // Check if index already exists
        const existingIndexes = await Ticket.collection.indexes();
        const otpIndexExists = existingIndexes.some(idx => {
            const keys = Object.keys(idx.key);
            return keys.length === 1 && keys[0] === 'otp' && idx.unique === true;
        });

        if (otpIndexExists) {
            info('Unique index on otp field already exists');
            return { created: false, skipped: true };
        }

        // Create unique index on otp field
        await Ticket.collection.createIndex(
            { otp: 1 },
            { unique: true, background: true, name: 'otp_1_unique' }
        );

        info('Unique index on otp field created successfully');
        return { created: true, skipped: false };
    } catch (err) {
        error('Error migrating Ticket OTP unique index:', err);
        throw err;
    }
}

async function ensureIndexes() {
    info('Ensuring indexes are created');

    try {
        const Merchant = mongoModel.Merchant;
        const Event = mongoModel.Event;
        const ExternalTicketSales = mongoModel.ExternalTicketSales;

        // Helper function to safely create index
        const safeCreateIndex = async (collection, indexSpec, options = {}) => {
            try {
                // Check if index already exists
                const existingIndexes = await collection.indexes();
                const indexKey = JSON.stringify(indexSpec);
                const indexExists = existingIndexes.some(idx =>
                    JSON.stringify(idx.key) === indexKey
                );

                if (indexExists) {
                    info(`Index already exists: ${JSON.stringify(indexSpec)}`);
                    return;
                }

                await collection.createIndex(indexSpec, options);
                info(`Index created: ${JSON.stringify(indexSpec)}`);
            } catch (err) {
                // If index already exists with different options, that's okay
                if (err.code === 86 || err.codeName === 'IndexKeySpecsConflict') {
                    warn(`Index conflict (may already exist): ${err.message}`);
                } else {
                    throw err;
                }
            }
        };

        // Ensure merchant indexes - merchantId is unique in schema
        // Note: The unique index is already created by Mongoose schema definition
        // We just ensure it exists, but don't recreate if it conflicts
        try {
            await Merchant.collection.createIndex(
                { merchantId: 1 },
                { unique: true, background: true }
            );
            info('Merchant merchantId index ensured');
        } catch (err) {
            if (err.code === 86 || err.codeName === 'IndexKeySpecsConflict') {
                info('Merchant merchantId index already exists');
            } else {
                throw err;
            }
        }

        // Ensure event indexes
        await safeCreateIndex(
            Event.collection,
            { externalMerchantId: 1, externalEventId: 1 },
            { unique: true, background: true }
        );
        info('Event compound index ensured');

        await safeCreateIndex(
            Event.collection,
            { 'featured.isFeatured': 1, 'featured.priority': -1 },
            { background: true }
        );
        info('Event featured index ensured');

        // Ensure external ticket sales indexes
        await safeCreateIndex(
            ExternalTicketSales.collection,
            { eventId: 1, source: 1 },
            { background: true }
        );
        info('ExternalTicketSales compound index ensured');

        await safeCreateIndex(
            ExternalTicketSales.collection,
            { externalEventId: 1, source: 1 },
            { background: true }
        );
        info('ExternalTicketSales externalEventId index ensured');

        info('All indexes ensured');
    } catch (err) {
        error('Error ensuring indexes:', err);
        throw err;
    }
}

async function trackMigration(version, results) {
    try {
        // Create a migration tracking collection
        const Migration = mongoose.models.Migration || mongoose.model('Migration', new mongoose.Schema({
            version: { type: String, required: true, unique: true },
            appliedAt: { type: Date, default: Date.now },
            results: mongoose.Schema.Types.Mixed
        }));

        await Migration.findOneAndUpdate(
            { version },
            {
                version,
                appliedAt: new Date(),
                results
            },
            { upsert: true }
        );

        info(`Migration ${version} tracked`);
    } catch (err) {
        error('Error tracking migration:', err);
        // Don't throw - tracking failure shouldn't fail migration
    }
}

async function runMigrations() {
    try {
        info(`Starting migration version: ${MIGRATION_VERSION}`);

        // Wait for MongoDB connection
        await waitForConnection();

        const results = {
            merchantOtherInfo: {},
            settingOtherInfo: {},
            ticketOtpIndex: {},
            indexes: 'ensured'
        };

        // Run migrations
        results.merchantOtherInfo = await migrateMerchantOtherInfo();
        results.settingOtherInfo = await migrateSettingOtherInfo();
        results.ticketOtpIndex = await migrateTicketOtpUniqueIndex();
        await ensureIndexes();

        // Track migration
        await trackMigration(MIGRATION_VERSION, results);

        info(`Migration ${MIGRATION_VERSION} completed successfully`);
        console.log('\n=== Migration Summary ===');
        console.log(`Version: ${MIGRATION_VERSION}`);
        console.log(`Merchant otherInfo: ${results.merchantOtherInfo.updated} updated, ${results.merchantOtherInfo.skipped} skipped`);
        console.log(`Setting otherInfo: ${results.settingOtherInfo.updated} updated, ${results.settingOtherInfo.skipped} skipped`);
        console.log(`Ticket OTP Index: ${results.ticketOtpIndex.created ? 'Created' : results.ticketOtpIndex.skipped ? 'Already exists' : 'Failed'}`);
        console.log('Indexes: Ensured');
        console.log('========================\n');

        process.exit(0);
    } catch (err) {
        error('Migration failed:', err);
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

// Run migrations if script is executed directly
// Check if this file is being run directly (not imported)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1]?.includes('migrate-schemas.js')) {
    runMigrations();
}

export { runMigrations, MIGRATION_VERSION };

