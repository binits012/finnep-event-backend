#!/usr/bin/env node
/**
 * Patch payment.completed outbox rows missing febMerchantId/emsMerchantId, then reset to pending for replay.
 *
 * Usage:
 *   node scripts/patchAccountingOutboxMerchants.mjs [--dry-run]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { resolveTicketMerchant } from './lib/resolveTicketMerchant.mjs';

const dryRun = process.argv.includes('--dry-run');

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
  const outbox = db.collection('outboxmessages');

  const cursor = outbox.find({
    routingKey: 'payment.completed',
    $or: [
      { 'messageBody.data.febMerchantId': { $exists: false } },
      { 'messageBody.data.febMerchantId': null },
      { 'messageBody.data.emsMerchantId': { $exists: false } },
      { 'messageBody.data.emsMerchantId': null },
    ],
  });

  let patched = 0;
  let unrecoverable = 0;

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    const data = row.messageBody?.data || {};
    const ticketId = Array.isArray(data.ticketIds) ? data.ticketIds[0] : null;
    if (!ticketId) {
      unrecoverable += 1;
      continue;
    }

    const ticket = await db.collection('tickets').findOne({ _id: new mongoose.Types.ObjectId(String(ticketId)) });
    if (!ticket) {
      unrecoverable += 1;
      continue;
    }

    const resolved = await resolveTicketMerchant(db, ticket);
    if (!resolved.febMerchantId && !resolved.emsMerchantId) {
      unrecoverable += 1;
      console.warn('[unrecoverable]', ticketId);
      continue;
    }

    const nextData = {
      ...data,
      febMerchantId: resolved.febMerchantId,
      emsMerchantId: resolved.emsMerchantId,
      platformMerchantId: resolved.emsMerchantId,
    };

    if (dryRun) {
      console.log('[dry-run patch]', ticketId, nextData.febMerchantId, nextData.emsMerchantId);
      patched += 1;
      continue;
    }

    await outbox.updateOne(
      { _id: row._id },
      {
        $set: {
          'messageBody.data': nextData,
          status: 'pending',
          attempts: 0,
          nextRetryAt: null,
        },
      }
    );
    patched += 1;
  }

  // Reset already-sent rows that were never consumed into FAS (safe to replay; FAS dedupes by messageId)
  if (!dryRun && patched > 0) {
    console.log(`Patched ${patched} row(s); unrecoverable ${unrecoverable}. Re-run: node scripts/replayAccountingOutbox.mjs`);
  } else {
    console.log(`Patched ${patched} (dry-run=${dryRun}), unrecoverable ${unrecoverable}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
