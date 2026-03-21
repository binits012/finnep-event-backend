#!/usr/bin/env node

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import '../model/dbConnect.js';
import { Event } from '../model/mongoModel.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');
const timeZone = process.env.TIME_ZONE || 'Europe/Helsinki';

function toEndOfDayDate(sourceDate, fallbackDate = new Date()) {
  return moment(sourceDate || fallbackDate).tz(timeZone).endOf('day').toDate();
}

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

async function backfillEventEndDate() {
  await waitForConnection();

  const query = {
    $or: [
      { event_end_date: { $exists: false } },
      { event_end_date: null },
    ],
  };

  const events = await Event.find(query)
    .select('_id eventDate createdAt event_end_date')
    .lean();

  console.log(`[event_end_date migration] timezone=${timeZone}`);
  console.log(`[event_end_date migration] found ${events.length} events to patch`);

  if (events.length === 0) return;

  const bulkOps = events.map((eventDoc) => {
    const computedEndDate = toEndOfDayDate(eventDoc.eventDate, eventDoc.createdAt);
    return {
      updateOne: {
        filter: { _id: eventDoc._id },
        update: { $set: { event_end_date: computedEndDate } },
      },
    };
  });

  if (isDryRun) {
    console.log('[event_end_date migration] dry-run only, no writes applied');
    console.log(`[event_end_date migration] would update ${bulkOps.length} events`);
    return;
  }

  const result = await Event.bulkWrite(bulkOps, { ordered: false });
  console.log(
    `[event_end_date migration] done: matched=${result.matchedCount}, modified=${result.modifiedCount}`
  );
}

backfillEventEndDate()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[event_end_date migration] failed:', err);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });

