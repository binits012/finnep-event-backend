#!/usr/bin/env node

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { Event } from '../model/mongoModel.js';
import { cacheShortCodeMapping, isValidShortCode } from '../util/shortCode.js';

dotenv.config();

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

async function warmShortlinkCache() {
  await waitForConnection();

  const events = await Event.find({ shortCode: { $type: 'string', $ne: '' } })
    .select('_id shortCode')
    .lean();

  console.log(`[shortlink cache] warming ${events.length} events`);

  let warmed = 0;
  for (const event of events) {
    const shortCode = event.shortCode != null ? String(event.shortCode).trim() : '';
    if (!isValidShortCode(shortCode)) continue;

    await cacheShortCodeMapping(shortCode, event._id.toString());
    warmed++;
  }

  console.log(`[shortlink cache] complete: ${warmed} mappings warmed`);
}

warmShortlinkCache()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[shortlink cache] failed:', err);
    process.exit(1);
  });
