#!/usr/bin/env node

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { Event } from '../model/mongoModel.js';
import {
  generateUniqueShortCode,
  cacheShortCodeMapping,
  isValidShortCode,
} from '../util/shortCode.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

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

async function backfillEventShortCodes() {
  await waitForConnection();

  const query = {
    $or: [
      { shortCode: { $exists: false } },
      { shortCode: null },
      { shortCode: '' },
    ],
  };

  const events = await Event.find(query).select('_id shortCode').lean();
  console.log(`[shortCode migration] found ${events.length} events without shortCode`);

  if (events.length === 0) return;

  let updated = 0;
  for (const event of events) {
    const shortCode = await generateUniqueShortCode(Event);
    if (!isValidShortCode(shortCode)) {
      throw new Error(`Generated invalid shortCode for event ${event._id}`);
    }

    if (isDryRun) {
      console.log(`[dry-run] would assign ${shortCode} -> ${event._id}`);
      updated++;
      continue;
    }

    await Event.updateOne({ _id: event._id }, { $set: { shortCode } });
    await cacheShortCodeMapping(shortCode, event._id.toString());
    console.log(`[shortCode migration] assigned ${shortCode} -> ${event._id}`);
    updated++;
  }

  console.log(`[shortCode migration] complete: ${updated} events ${isDryRun ? 'would be ' : ''}updated`);
  if (!isDryRun && updated > 0) {
    console.log('[shortCode migration] Re-activate affected events in CMS so merchant QR receives shortCode via EventActivated sync.');
  }
}

backfillEventShortCodes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[shortCode migration] failed:', err);
    process.exit(1);
  });
