/**
 * One-time backfill: copy ticketInfo.paymentIntentId to top-level paymentIntentId
 * for legacy Stripe tickets.
 *
 * Usage: node scripts/backfill-payment-intent-id.js [--dry-run]
 */
import '../model/dbConnect.js';
import { Ticket } from '../model/mongoModel.js';

const dryRun = process.argv.includes('--dry-run');

const ticketInfoToPlain = (ticketInfo) => {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo);
    return typeof ticketInfo === 'object' ? ticketInfo : {};
};

const run = async () => {
    const cursor = Ticket.find({
        paymentIntentId: { $in: [null, ''] },
        $or: [
            { paymentProvider: 'stripe' },
            { 'ticketInfo.paymentIntentId': { $exists: true, $ne: null } },
            { 'ticketInfo.payment_intent_id': { $exists: true, $ne: null } }
        ]
    }).cursor();

    let scanned = 0;
    let updated = 0;

    for await (const ticket of cursor) {
        scanned += 1;
        const info = ticketInfoToPlain(ticket.ticketInfo);
        const paymentIntentId = info.paymentIntentId || info.payment_intent_id || ticket.paymentReference;
        if (!paymentIntentId || !String(paymentIntentId).startsWith('pi_')) {
            continue;
        }

        const update = {
            paymentIntentId,
            paymentProvider: ticket.paymentProvider || 'stripe',
            paymentReference: ticket.paymentReference || paymentIntentId,
            paymentStatus: ticket.paymentStatus || 'paid'
        };

        if (dryRun) {
            console.log('[dry-run] would update', ticket._id.toString(), update);
        } else {
            await Ticket.updateOne({ _id: ticket._id }, { $set: update });
        }
        updated += 1;
    }

    console.log(JSON.stringify({ dryRun, scanned, updated }, null, 2));
    process.exit(0);
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
