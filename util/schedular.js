import * as fs from 'fs/promises';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Agenda } from '@hokify/agenda';
import { TicketReport, getAllTicketReport } from '../model/reporting.js';
import '../model/dbConnect.js';
import { forward, retryForward } from './sendMail.js';
import { error, info } from '../model/logger.js';
import { getUsersByRole } from '../model/users.js';
import { getContactById } from '../model/contact.js';
import { ROLE_ADMIN } from '../const.js';
import { dirname } from 'path';
import { getOutboxMessagesForRetry, updateOutboxMessageById, createOutboxMessagesBatch } from '../model/outboxMessage.js';
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js';
import { Event } from '../model/mongoModel.js';
import { QUEUE_PREFETCH } from '../rabbitMQ/services/queueSetup.js';
import { v4 as uuidv4 } from 'uuid';
import { compileMjmlTemplate } from './emailTemplateLoader.js';

dotenv.config();
const __dirname = dirname(import.meta.url).slice(7);
console.log(__dirname);

// Connection options for MongoDB
const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${encodeURIComponent(process.env.MONGODB_HOST)}:${encodeURIComponent(process.env.MONGODB_PORT)}/${encodeURIComponent(process.env.MONGODB_NAME)}?authSource=admin&useNewUrlParser=true`;

// Create a robust Agenda instance with connection options
let agenda = null;
let reconnectTimer = null;
let isConnecting = false;

function setupAgenda() {
  if (isConnecting) return;

  try {
    isConnecting = true;

    // Clean up any existing reconnection timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Create new agenda instance with robust connection options
    agenda = new Agenda({
      db: {
        address: dbURI,
        options: {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          keepAlive: true,
          keepAliveInitialDelay: 300000
        }
      },
      processEvery: '30 seconds',
      maxConcurrency: 20
    });

    // Define event handlers
    agenda.on('ready', () => {
      console.log("Agenda connected and ready!");
      isConnecting = false;

      // Define jobs only after connection is established
      defineJobs();

      // Schedule recurring jobs
      scheduleJobs();
    });

    agenda.on('error', (err) => {
      console.error("Agenda connection error:", err);
      isConnecting = false;

      // Attempt reconnection after error
      reconnectTimer = setTimeout(setupAgenda, 5000);
    });

    // Start Agenda
    agenda.start();

  } catch (err) {
    console.error("Error setting up Agenda:", err);
    isConnecting = false;

    // Attempt reconnection after error
    reconnectTimer = setTimeout(setupAgenda, 5000);
  }
}

// Define all jobs in one place
function defineJobs() {
  // Job 1: Process failure mails
  agenda.define('failure mails', async (job) => {
    try {
      const tickets = await TicketReport.find({retryCount:{$lte:5}});

      for (const e of tickets) {
        const id = e.id;
        const emailData = e.emailData;
        let retryCount = e.retryCount;

        try {
          const data = await retryForward(id, emailData, retryCount);

          if (data != null) {
            info('retrying sending mail to %s ', emailData.to + " successfully completed.");
            await TicketReport.findByIdAndDelete({_id:id});
            info('retrying id %s', id + " is deleted.");
          }
        } catch (err) {
          error('retrying id %s is still failing ', id);
        }
      }
    } catch (err) {
      error('Error in failure mails job:', err);
    }
  }, { priority: 'high', concurrency: 30 });

  // Job 3: Process outbox message retries
  agenda.define('process outbox retries', async (job) => {
    try {
      info('Starting outbox message retry processing');

      // Get messages that are ready for retry
      // Use same concurrency as queue prefetch for consistency
      const BATCH_SIZE = 50;
      const messagesToRetry = await getOutboxMessagesForRetry(BATCH_SIZE);

      if (!messagesToRetry || messagesToRetry.length === 0) {
        info('No outbox messages to retry');
        return;
      }

      info(`Found ${messagesToRetry.length} outbox messages to retry (concurrency: ${QUEUE_PREFETCH})`);

      // Ensure channel is ready ONCE for all messages
      await messageConsumer.ensureChannelsReady();
      const results = { success: [], failed: [] };
      const now = new Date();

      // Process messages in batches matching queue prefetch setting
      for (let i = 0; i < messagesToRetry.length; i += QUEUE_PREFETCH) {
        const batch = messagesToRetry.slice(i, i + QUEUE_PREFETCH);

        await Promise.allSettled(
          batch.map(async (message) => {
            try {
              // Republish the message to RabbitMQ
              await messageConsumer.publishToExchange(
                message.exchange,
                message.routingKey,
                message.messageBody,
                {
                  exchangeType: 'topic',
                  durable: true
                }
              );

              results.success.push({
                _id: message._id,
                messageId: message.messageId
              });

            } catch (err) {
              error(`Failed to retry outbox message ${message.messageId}:`, err);

              // Calculate retry data
              const currentAttempts = message.attempts + 1;
              const updateData = {
                _id: message._id,
                messageId: message.messageId,
                attempts: currentAttempts,
                lastError: err.message || 'Unknown error during retry'
              };

              // Check if max retries reached
              if (currentAttempts >= message.maxRetries) {
                updateData.status = 'failed';
                updateData.nextRetryAt = null;
              } else {
                // Calculate next retry with exponential backoff
                const baseDelay = 60000; // 1 minute
                const maxDelay = 3600000; // 1 hour
                const delay = Math.min(baseDelay * Math.pow(2, currentAttempts), maxDelay);
                updateData.nextRetryAt = new Date(Date.now() + delay);
                updateData.status = 'retrying';
              }

              results.failed.push(updateData);
            }
          })
        );
      }

      // Batch update successful messages
      if (results.success.length > 0) {
        const successIds = results.success.map(m => m._id);
        await mongoose.connection.collection('outboxmessages').updateMany(
          { _id: { $in: successIds } },
          {
            $set: {
              status: 'sent',
              sentAt: now,
              processedAt: now
            }
          }
        );
        info(`Successfully retried ${results.success.length} messages`);
      }

      // Batch update failed messages
      if (results.failed.length > 0) {
        const bulkOps = results.failed.map(m => ({
          updateOne: {
            filter: { _id: m._id },
            update: {
              $set: {
                attempts: m.attempts,
                lastError: m.lastError,
                status: m.status,
                nextRetryAt: m.nextRetryAt
              }
            }
          }
        }));

        await mongoose.connection.collection('outboxmessages').bulkWrite(bulkOps);
        info(`Updated ${results.failed.length} failed messages`);
      }

      info(`Outbox retry processing completed: ${results.success.length} successful, ${results.failed.length} failed`);

    } catch (err) {
      error('Error in outbox retry job:', err);
    }
  }, { priority: 'high', concurrency: 10 });

  // Job 2: Report failures
  agenda.define('report failures', async(job) => {
    try {
      const tickets = await TicketReport.find({retryCount:{$gte:5}});
      if (!tickets || tickets.length === 0) {
        info('No failed tickets to report');
        return;
      }

      let emailRows = '';

      for (const e of tickets) {
        const id = e.id;
        const emailData = e.emailData;
        const email = emailData.to;
        const event = emailData.subject;

        emailRows += `<tr><td>${id}</td><td>${email}</td><td>${event}</td></tr>\n`;
      }

      const adminUsers = await getUsersByRole(ROLE_ADMIN);

      for (const e of adminUsers) {
        const id = e.id;
        const contact = await getContactById(id);
        const username = contact.user.name;
        let email = contact.contact[0].data;

        if (email && email !== 'undefined') {
          const fileLocation = __dirname.replace('util', '') + '/emailTemplates/failure_report.html';
          const emailData = await loadEmailTemplate(fileLocation, username, emailRows);

          if (emailRows) {
            const message = {
              from: process.env.EMAIL_USERNAME,
              to: email,
              subject: "Failure emails, do needful",
              html: emailData.toString(),
            };

            try {
              await forward(message);

              // Delete processed tickets
              for (const ticket of tickets) {
                await TicketReport.findByIdAndDelete(ticket.id);
                info('deleted failure ticket id %s', ticket.id);
              }
            } catch (err) {
              error('error sending failure report:', err);
            }
          }
        }
      }
    } catch (err) {
      error('Error in report failures job:', err);
    }
  });

  // Job 4: inactive past events
  agenda.define('inactive past events', async(job) => {
    try {
      const now = new Date();
      console.log('inactive past events ================== now', now);
      // Batch update all past events to inactive in a single operation
      const result = await Event.updateMany(
        {
          eventDate: { $lt: now },
          active: { $ne: false }, // Only update events that are currently active
          status: { $ne: 'completed' } // Only exclude events that are already completed
        },
        {
          $set: { active: false, status: 'completed', updatedAt:new Date() }
        }
      );

      console.log('inactive past events ================== result', result);
      if (result.modifiedCount > 0) {
        info(`Deactivated ${result.modifiedCount} past events`);

        // Get the deactivated events to create outbox messages
        const pastEvents = await Event.find({
          eventDate: { $lt: now },
          status: { $eq: 'completed' },
          active: { $ne: true }
        });
        const routingKey = 'external.event.status.updated'
        const eventType = 'EventDeactivated';
        if (pastEvents && pastEvents.length > 0) {
          // Prepare outbox messages for all deactivated events
          const outboxMessages = pastEvents
            .filter(event => {
              // Validate required fields
              if (!event.externalMerchantId) {
                error(`Event ${event._id} missing externalMerchantId, skipping outbox message`);
                return false;
              }
              return true;
            })
            .map(event => {
              const correlationId = uuidv4();
              const messageId = uuidv4();

              return {
                messageId: messageId,
                exchange: 'event-merchant-exchange',
                routingKey: routingKey,
                messageBody: {
                  eventType: eventType,
                  aggregateId: event._id.toString(),
                  data: {
                    merchantId: event.externalMerchantId,
                    eventId: event.externalEventId,
                    before: {},
                    after: event,
                    updatedBy: 'system',
                    updatedAt: now
                  },
                  metadata: {
                    correlationId: correlationId,
                    causationId: messageId,
                    timestamp: new Date().toISOString(),
                    version: 1
                  }
                },
                headers: {
                  'content-type': 'application/json',
                  'message-type': eventType,
                  'correlation-id': correlationId
                },
                correlationId: correlationId,
                eventType: eventType,
                aggregateId: event._id.toString(),
                status: 'pending',
                exchangeType: 'topic'
              };
            });

          if (outboxMessages.length > 0) {
            // Batch write to outbox
            await batchWriteToOutbox(outboxMessages);
            info(`Created ${outboxMessages.length} outbox messages for completed events`);
          }
        }
      }
    } catch (err) {
      error('inactive past events ================== Error in inactive past events job:', err);
    }
  });

  // Job 5: change status of up-coming to on-going for today's events
  agenda.define('change status of up-coming to on-going for today\'s events', async(job) => {
    try {
      const now = new Date();
      // Get start and end of today (ignoring time)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      console.log('startOfToday', startOfToday);
      console.log('endOfToday', endOfToday);
      const result = await Event.updateMany(
        {
          eventDate: { $gte: startOfToday, $lte: endOfToday },
          status: { $ne: 'on-going' },
          active: { $ne: false }
        },
        {
          $set: { status: 'on-going', updatedAt:new Date() }
        }
      );
      if (result.modifiedCount > 0) {
        console.log('result', result);
        info(`Changed status of ${result.modifiedCount} up-coming events to on-going`);
      }
    } catch (err) {
      error('Error in change status of up-coming to on-going for today\'s events job:', err);
    }
  });
}

// Schedule all recurring jobs
function scheduleJobs() {
  // Schedule job 1: Check for failure mails every 45 minutes
  agenda.every('45 minutes', 'failure mails');

  // Schedule job 2: Daily report at 8:00 AM
  agenda.every('0 8 * * *', 'report failures');

  // Schedule job 3: Process outbox retries every 2 minutes
  agenda.every('2 minutes', 'process outbox retries');

  // Schedule job 4: Inactive past events - run every 6 hours
  agenda.every('6 hours', 'inactive past events');

  // Schedule job 5: Change status of up-coming to on-going - run once daily at 00:01 AM
  agenda.every('0 1 * * *', 'change status of up-coming to on-going for today\'s events');

  info('All jobs scheduled successfully');
}

// Email template helper
const loadEmailTemplate = async (fileLocation, username, emailRows) => {
  try {
    // Replace .html with .mjml in file path
    const mjmlPath = fileLocation.replace('.html', '.mjml');
    const variables = {
      adminName: username || 'Admin',
      trData: emailRows || '' // This will be inserted as unescaped HTML using {{{trData}}}
    };
    return await compileMjmlTemplate(mjmlPath, variables);
  } catch (err) {
    error('Error loading email template:', err);
    return `<p>Hello ${username || 'Admin'},</p><p>Failed email report:</p><table>${emailRows || ''}</table>`;
  }
};


/**
 * Write messages to outbox in batch for better performance
 * @param {Array} messages - Array of message objects matching createOutboxMessage structure
 * @returns {Promise<Array>} Array of created outbox messages
 */
const batchWriteToOutbox = async (messages) => {
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      info('No messages to write to outbox');
      return [];
    }

    // Messages should already have the complete structure, just pass them through
    const savedMessages = await createOutboxMessagesBatch(messages);
    info(`Successfully wrote ${savedMessages.length} messages to outbox`);

    return savedMessages;
  } catch (err) {
    error('Error batch writing to outbox:', err);
    throw err;
  }
};

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  console.log("MongoDB disconnected - will reconnect Agenda when MongoDB reconnects");

  // If agenda is running, stop it
  if (agenda) {
    agenda.stop().catch(err => {
      console.error("Error stopping Agenda:", err);
    });
  }
});

mongoose.connection.on('connected', () => {
  console.log("MongoDB reconnected - reconnecting Agenda");
  setupAgenda();
});

// Set up a heartbeat to check connection
setInterval(() => {
  if (mongoose.connection.readyState === 1 && agenda && agenda.mongoDb) {
    agenda.db.admin().ping()
      .then(() => console.log("Agenda MongoDB heartbeat successful"))
      .catch(err => {
        console.error("Agenda MongoDB heartbeat failed:", err);
        setupAgenda(); // Reconnect if heartbeat fails
      });
  }
}, 180000); // Every 3 minutes

// Handle application termination
process.on('SIGINT', async () => {
  if (agenda) {
    await agenda.stop();
    console.log('Agenda shut down gracefully');
  }
  process.exit(0);
});

// Initial setup
setupAgenda();

export default agenda;
export { batchWriteToOutbox };