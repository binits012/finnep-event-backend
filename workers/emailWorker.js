import { Worker, Queue } from 'bullmq';
import { info, error } from '../model/logger.js';
import { forward } from '../util/sendMail.js';
import * as Ticket from '../model/ticket.js';
import dotenv from 'dotenv';
dotenv.config();

export const EMAIL_QUEUE_NAME = 'email-queue';

// Redis connection config
const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PWD
};

// Create the queue instance (for adding jobs)
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, { connection });

// Create the worker (for processing jobs)
const emailWorker = new Worker(EMAIL_QUEUE_NAME, async (job) => {
    const { type, ticketId, emailPayload } = job.data;

    info(`Processing email job: ${job.id}`, {
        type,
        ticketId,
        to: emailPayload?.to,
        attempt: job.attemptsMade + 1
    });

    try {
        // For ticket emails, check if email was already sent (idempotency)
        if (type === 'email.ticket' && ticketId) {
            const ticket = await Ticket.getTicketById(ticketId);
            if (ticket && ticket.isSend) {
                info(`Email already sent for ticket: ${ticketId} - skipping duplicate email`);
                return { success: true, to: emailPayload.to, skipped: true, reason: 'already_sent' };
            }
        }

        await forward(emailPayload);

        // If it's a ticket email, update the ticket
        if (type === 'email.ticket' && ticketId) {
            await Ticket.updateTicketById(ticketId, { isSend: true });
            info(`Ticket email sent and marked for ticket: ${ticketId}`);
        } else {
            info(`Email sent successfully to: ${emailPayload.to}`);
        }

        return { success: true, to: emailPayload.to };
    } catch (err) {
        error(`Failed to send email (attempt ${job.attemptsMade + 1})`, {
            jobId: job.id,
            ticketId,
            to: emailPayload?.to,
            error: err.message
        });
        throw err; // Rethrow to trigger retry
    }
}, {
    connection,
    concurrency: 5, // Process up to 5 emails in parallel
    limiter: {
        max: 10,      // Max 10 jobs
        duration: 1000 // per 1 second (rate limiting)
    }
});

// Event handlers
emailWorker.on('completed', (job, result) => {
    info(`Email job ${job.id} completed`, { to: result?.to });
});

emailWorker.on('failed', (job, err) => {
    error(`Email job ${job.id} failed after ${job.attemptsMade} attempts`, {
        ticketId: job.data?.ticketId,
        to: job.data?.emailPayload?.to,
        error: err.message
    });
});

emailWorker.on('error', (err) => {
    error('Email worker error', { error: err.message });
});

// Helper function to add email job
export const queueTicketEmail = async (ticketId, emailPayload) => {
    return emailQueue.add('ticket-email', {
        type: 'email.ticket',
        ticketId,
        emailPayload,
        queuedAt: new Date().toISOString()
    }, {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000 // Start with 2s, then 4s, then 8s
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500      // Keep last 500 failed jobs for debugging
    });
};

export const queueGenericEmail = async (emailPayload) => {
    return emailQueue.add('generic-email', {
        type: 'email.generic',
        emailPayload,
        queuedAt: new Date().toISOString()
    }, {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 500
    });
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    info(`Email worker received ${signal}, closing...`);
    await emailWorker.close();
    await emailQueue.close();
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default emailWorker;
