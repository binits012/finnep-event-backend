/**
 * MongoDB support for free-event custom registration forms.
 *
 * - Ensures sparse index on events that define otherInfo.registrationForm
 * - Ensures sparse index on tickets with ticketInfo.registrationAnswers
 * - Idempotent; safe to run in production
 *
 * Run: node scripts/backfill-free-event-registration-form.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import '../model/dbConnect.js';
import * as mongoModel from '../model/mongoModel.js';
import { info, error } from '../model/logger.js';

const MIGRATION_VERSION = '2026-08-29-free-event-registration-form';

async function waitForConnection() {
    let retries = 0;
    while (mongoose.connection.readyState !== 1 && retries < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        retries += 1;
    }
    if (mongoose.connection.readyState !== 1) {
        throw new Error('Failed to connect to MongoDB');
    }
}

async function ensureRegistrationIndexes() {
    const Event = mongoModel.Event;
    const Ticket = mongoModel.Ticket;

    await Event.collection.createIndex(
        { 'otherInfo.registrationForm.fields': 1 },
        {
            name: 'event_registration_form_fields',
            sparse: true,
            background: true,
        }
    );
    info('Event otherInfo.registrationForm.fields index ensured');

    await Ticket.collection.createIndex(
        { 'ticketInfo.registrationAnswers': 1 },
        {
            name: 'ticket_registration_answers',
            sparse: true,
            background: true,
        }
    );
    info('Ticket ticketInfo.registrationAnswers index ensured');
}

async function trackMigration(results) {
    const Migration = mongoose.models.Migration || mongoose.model(
        'Migration',
        new mongoose.Schema({
            version: { type: String, required: true, unique: true },
            appliedAt: { type: Date, default: Date.now },
            results: mongoose.Schema.Types.Mixed,
        })
    );

    await Migration.findOneAndUpdate(
        { version: MIGRATION_VERSION },
        { version: MIGRATION_VERSION, appliedAt: new Date(), results },
        { upsert: true }
    );
}

async function main() {
    await waitForConnection();
    info(`Starting Mongo migration: ${MIGRATION_VERSION}`);

    await ensureRegistrationIndexes();

    const eventsWithForm = await mongoModel.Event.countDocuments({
        'otherInfo.registrationForm.fields.0': { $exists: true },
    });
    const ticketsWithAnswers = await mongoModel.Ticket.countDocuments({
        'ticketInfo.registrationAnswers': { $exists: true },
    });

    const results = {
        eventsWithRegistrationForm: eventsWithForm,
        ticketsWithRegistrationAnswers: ticketsWithAnswers,
        indexes: 'ensured',
    };

    await trackMigration(results);

    info('Migration completed', results);
    console.log('\n=== Free event registration form (Mongo) ===');
    console.log(`Version: ${MIGRATION_VERSION}`);
    console.log(`Events with registration form: ${eventsWithForm}`);
    console.log(`Tickets with registration answers: ${ticketsWithAnswers}`);
    console.log('Indexes: ensured');
    console.log('==========================================\n');

    process.exit(0);
}

main().catch((err) => {
    error('Migration failed:', err);
    process.exit(1);
});
