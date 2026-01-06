#!/usr/bin/env node

/**
 * Backfill script to add missing fields to existing outbox messages
 * This ensures all messages can be properly queried and processed
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { OutboxMessage } from '../model/mongoModel.js';

dotenv.config();

async function backfillOutboxMessages() {
  try {
    console.log('Starting outbox messages backfill...');

    // Wait for connection
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => {
        mongoose.connection.once('connected', resolve);
      });
    }

    // Find all messages missing required fields using Mongoose model
    const messagesToBackfill = await OutboxMessage.find({
      $or: [
        { attempts: { $exists: false } },
        { attempts: null },
        { createdAt: { $exists: false } },
        { createdAt: null },
        { maxRetries: { $exists: false } },
        { maxRetries: null }
      ]
    }).lean();

    console.log(`Found ${messagesToBackfill.length} messages to backfill`);

    if (messagesToBackfill.length === 0) {
      console.log('No messages need backfilling');
      await mongoose.connection.close();
      process.exit(0);
    }

    let updated = 0;
    const bulkOps = [];

    for (const msg of messagesToBackfill) {
      const update = {};

      if (msg.attempts === undefined || msg.attempts === null) {
        update.attempts = 0;
      }

      if (msg.maxRetries === undefined || msg.maxRetries === null) {
        update.maxRetries = 3;
      }

      if (!msg.createdAt) {
        // Use _id timestamp if createdAt is missing
        update.createdAt = msg._id.getTimestamp();
      }

      if (Object.keys(update).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { _id: msg._id },
            update: { $set: update }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      const result = await OutboxMessage.bulkWrite(bulkOps, { ordered: false });
      updated = result.modifiedCount;
      console.log(`Bulk write result: matched ${result.matchedCount}, modified ${result.modifiedCount}`);
    }

    console.log(`Successfully backfilled ${updated} messages`);
    console.log('Backfill completed!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during backfill:', err);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

backfillOutboxMessages();

