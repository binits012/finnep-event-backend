#!/usr/bin/env node
/**
 * Drop the legacy MongoDB `coupons` collection (Yellow Bridge era).
 * Current FEB uses events.discountCodes[] synced from EMS — not this collection.
 *
 * Usage:
 *   node scripts/drop-legacy-coupons-collection.mjs           # dry-run (default)
 *   node scripts/drop-legacy-coupons-collection.mjs --confirm # drop collection
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';

dotenv.config();

const COLLECTION = 'coupons';
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
  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: COLLECTION }).toArray();

  if (collections.length === 0) {
    console.log(`Collection "${COLLECTION}" does not exist — nothing to do.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const count = await db.collection(COLLECTION).countDocuments();
  const sample = await db.collection(COLLECTION).find({}).limit(3).project({ code: 1, event: 1, quantity: 1 }).toArray();

  console.log(`Database: ${db.databaseName}`);
  console.log(`Collection: ${COLLECTION}`);
  console.log(`Documents: ${count}`);
  if (sample.length) {
    console.log('Sample:', JSON.stringify(sample, null, 2));
  }

  if (!isConfirm) {
    console.log('\nDry run only. Re-run with --confirm to drop the collection.');
    await mongoose.disconnect();
    process.exit(0);
  }

  await db.dropCollection(COLLECTION);
  console.log(`\nDropped collection "${COLLECTION}".`);
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
