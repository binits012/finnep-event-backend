#!/usr/bin/env node
/**
 * Drop legacy global unique indexes on events.eventTitle and events.eventName.
 * Titles are not globally unique across merchants; linkage is externalMerchantId + externalEventId.
 *
 * Usage:
 *   node scripts/drop-legacy-event-unique-indexes.mjs           # dry-run (default)
 *   node scripts/drop-legacy-event-unique-indexes.mjs --confirm   # drop indexes
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';

dotenv.config();

const COLLECTION = 'events';
const LEGACY_INDEXES = ['eventTitle_1', 'eventName_1'];
const isConfirm = process.argv.includes('--confirm');

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

async function main() {
  await waitForConnection();
  const collection = mongoose.connection.collection(COLLECTION);
  const indexes = await collection.indexes();
  const toDrop = indexes.filter((idx) => LEGACY_INDEXES.includes(idx.name));

  console.log(`Database: ${mongoose.connection.db.databaseName}`);
  console.log(`Collection: ${COLLECTION}`);

  if (toDrop.length === 0) {
    console.log('No legacy eventTitle/eventName unique indexes found — nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  for (const idx of toDrop) {
    console.log(`Found legacy index: ${idx.name}`, JSON.stringify(idx.key), idx.unique ? '(unique)' : '');
  }

  if (!isConfirm) {
    console.log('\nDry run only. Re-run with --confirm to drop the indexes above.');
    await mongoose.disconnect();
    process.exit(0);
  }

  for (const idx of toDrop) {
    await collection.dropIndex(idx.name);
    console.log(`Dropped index: ${idx.name}`);
  }

  console.log('\nLegacy event unique indexes removed.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
