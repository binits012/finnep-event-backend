#!/usr/bin/env node
/**
 * Replay pending accounting outbox rows to RabbitMQ (payment.completed, etc.).
 * Use after backfill when messages were saved to Mongo but not published.
 *
 * Usage:
 *   node scripts/replayAccountingOutbox.mjs [--dry-run] [--limit=500] [--include-sent]
 *
 * Requires FAS running to consume into ledger_entries.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js';
import * as OutboxMessage from '../model/outboxMessage.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeSent = args.includes('--include-sent');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 500;

const ACCOUNTING_ROUTING_KEYS = new Set([
  'payment.completed',
  'payment.refunded',
  'accounting.external.sales',
]);

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
  if (!dryRun) {
    await messageConsumer.ensureChannelsReady();
  }

  const pending = await OutboxMessage.getOutboxMessagesByStatus('pending', limit);
  let messages = pending.filter((m) => ACCOUNTING_ROUTING_KEYS.has(m.routingKey));

  if (includeSent) {
    const sent = await mongoose.connection.db.collection('outboxmessages')
      .find({ routingKey: { $in: [...ACCOUNTING_ROUTING_KEYS] }, status: 'sent' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    messages = [...messages, ...sent];
  }

  let published = 0;
  let failed = 0;

  for (const message of messages) {
    if (dryRun) {
      console.log('[dry-run]', message.routingKey, message.messageId);
      published += 1;
      continue;
    }

    try {
      await messageConsumer.publishToExchange(
        message.exchange,
        message.routingKey,
        message.messageBody,
        {
          exchangeType: 'topic',
          durable: true,
          ...(message.messageId && { publishOptions: { messageId: message.messageId } }),
        }
      );
      if (message.status !== 'sent') {
        await OutboxMessage.markMessageAsSent(message._id);
      }
      published += 1;
    } catch (err) {
      failed += 1;
      console.error('Failed', message.messageId, message.routingKey, err?.message);
    }
  }

  console.log(
    `Replayed ${published} accounting outbox message(s), failed ${failed}${dryRun ? ' (dry-run)' : ''} (scanned ${messages.length}${includeSent ? ' incl. sent' : ' pending'})`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
