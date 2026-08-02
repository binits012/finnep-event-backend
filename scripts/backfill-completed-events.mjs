#!/usr/bin/env node
/**
 * One-time backfill: mark already-past events as completed in FEB and sync status to EMS.
 *
 * Usage: node scripts/backfill-completed-events.mjs [--dry-run]
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { Event } from '../model/mongoModel.js';
import {
  buildEventStatusOutboxMessage,
  publishEventStatusUpdates,
} from '../src/services/eventStatusSyncService.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');
const BUFFER_MS = 5 * 60 * 60 * 1000;

const effectiveEndDateExpr = {
  $ifNull: ['$event_end_date', { $ifNull: ['$eventEndDate', { $ifNull: ['$endDate', '$eventDate'] }] }],
};

async function waitForConnection() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 30000);
    mongoose.connection.once('connected', () => {
      clearTimeout(timeout);
      resolve();
    });
    mongoose.connection.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function backfillCompletedEvents() {
  await waitForConnection();

  const now = new Date();
  const fiveHoursAgo = new Date(now.getTime() - BUFFER_MS);

  const events = await Event.find({
    $expr: { $lt: [effectiveEndDateExpr, fiveHoursAgo] },
    status: { $ne: 'completed' },
  }).lean();

  console.log(`[completed backfill] dryRun=${isDryRun} found=${events.length}`);

  if (events.length === 0) {
    process.exit(0);
    return;
  }

  if (isDryRun) {
    events.slice(0, 20).forEach((event) => {
      console.log('[dry-run]', {
        id: event._id.toString(),
        title: event.eventTitle,
        status: event.status,
        active: event.active,
        externalMerchantId: event.externalMerchantId,
        externalEventId: event.externalEventId,
      });
    });
    if (events.length > 20) {
      console.log(`[dry-run] ... and ${events.length - 20} more`);
    }
    process.exit(0);
    return;
  }

  const eventIds = events.map((event) => event._id);
  const result = await Event.updateMany(
    {
      _id: { $in: eventIds },
      $expr: { $lt: [effectiveEndDateExpr, fiveHoursAgo] },
    },
    { $set: { active: false, status: 'completed', updatedAt: now } }
  );

  console.log(`[completed backfill] modified=${result.modifiedCount}`);

  const outboxMessages = events
    .filter((event) => event.externalMerchantId && event.externalEventId != null)
    .map((event) =>
      buildEventStatusOutboxMessage({
        event,
        before: { active: event.active, status: event.status },
        after: { active: false, status: 'completed' },
        eventType: 'EventDeactivated',
        updatedBy: 'system-backfill',
        updatedAt: now,
      })
    );

  const syncResult = await publishEventStatusUpdates(outboxMessages);
  console.log(
    JSON.stringify(
      {
        dryRun: false,
        found: events.length,
        modified: result.modifiedCount,
        published: syncResult.published,
        failed: syncResult.failed,
      },
      null,
      2
    )
  );

  process.exit(0);
}

backfillCompletedEvents().catch((err) => {
  console.error(err);
  process.exit(1);
});
