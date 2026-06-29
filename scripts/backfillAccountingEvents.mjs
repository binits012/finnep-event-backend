#!/usr/bin/env node
/**
 * One-time backfill: publish payment.completed for historical FEB tickets.
 *
 * Usage (from finnep-eventapp-backend):
 *   node scripts/backfillAccountingEvents.mjs [--dry-run] [--limit=1000] [--since=2024-01-01]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import '../model/dbConnect.js';
import { publishPaymentCompleted } from '../services/accountingEventPublisher.js';
import {
  resolveOrderQuantityFromTicket,
  readRecordedPlatformFeeCents,
} from '../util/merchantPlatformFee.js';
import { resolveTicketMerchant, ticketInfoObject } from './lib/resolveTicketMerchant.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const sinceArg = args.find((a) => a.startsWith('--since='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 5000;
const since = sinceArg ? new Date(sinceArg.split('=')[1]) : new Date('2020-01-01');

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
  const tickets = db.collection('tickets');

  const query = {
    createdAt: { $gte: since },
    paymentStatus: { $ne: 'refunded' },
  };

  const cursor = tickets.find(query).sort({ createdAt: 1 }).limit(limit);
  let count = 0;
  let published = 0;
  let skipped = 0;
  const publishedPaymentRefs = new Set();

  while (await cursor.hasNext()) {
    const ticket = await cursor.next();
    count += 1;
    const info = ticketInfoObject(ticket);
    const { event, merchant, febMerchantId, emsMerchantId } = await resolveTicketMerchant(db, ticket);

    if (!febMerchantId && !emsMerchantId) {
      skipped += 1;
      console.warn('[skip] no merchant identity for ticket', String(ticket._id));
      continue;
    }

    const method = (ticket.paymentProvider || info.paymentProvider || 'stripe').toLowerCase();
    const externalPaymentId =
      ticket.paymentIntentId ||
      ticket.paymentReference ||
      ticket.paytrailTransactionId ||
      ticket.nabilTransactionId ||
      `ticket:${ticket._id}`;

    if (publishedPaymentRefs.has(externalPaymentId)) {
      skipped += 1;
      continue;
    }

    const orderQuantity = resolveOrderQuantityFromTicket(ticket);
    const platformFeeCents = readRecordedPlatformFeeCents(ticket);

    const priceMajor = Number(info.price ?? info.totalPrice ?? info.totalAmount ?? 0);
    const grossCents = method === 'free' ? 0 : Math.round(priceMajor * 100);

    if (dryRun) {
      console.log('[dry-run]', externalPaymentId, method, grossCents, 'fee', platformFeeCents, 'qty', orderQuantity);
      published += 1;
      publishedPaymentRefs.add(externalPaymentId);
      continue;
    }

    try {
      await publishPaymentCompleted({
        ticket,
        event: event || { _id: ticket.event || info.eventId, country: info.country },
        merchant,
        method: method === 'free' || grossCents === 0 ? 'free' : method,
        externalPaymentId,
        grossCents,
        pspFeeCents: 0,
        checkoutChannel: 'marketplace',
        currency: (info.currency || 'eur').toLowerCase(),
        completedAt: ticket.createdAt?.toISOString?.() || new Date().toISOString(),
      });
      published += 1;
      publishedPaymentRefs.add(externalPaymentId);
    } catch (err) {
      console.error('Failed', externalPaymentId, err?.message);
    }
  }

  console.log(`Scanned ${count} tickets, published ${published}, skipped ${skipped}${dryRun ? ' (dry-run)' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
