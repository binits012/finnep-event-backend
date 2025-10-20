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
      
      const { getOutboxMessagesForRetry, updateOutboxMessageById } = await import('../model/outboxMessage.js');
      const { messageConsumer } = await import('../rabbitMQ/services/messageConsumer.js');
      
      // Get messages that are ready for retry (limit 50 per run)
      const messagesToRetry = await getOutboxMessagesForRetry(50);
      
      if (!messagesToRetry || messagesToRetry.length === 0) {
        info('No outbox messages to retry');
        return;
      }
      
      info(`Found ${messagesToRetry.length} outbox messages to retry`);
      
      let successCount = 0;
      let failureCount = 0;
      
      for (const message of messagesToRetry) {
        try {
          // Ensure message consumer is ready
          await messageConsumer.ensureChannelsReady();
          
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
          
          // Mark as sent
          await updateOutboxMessageById(message._id, {
            status: 'sent',
            sentAt: new Date(),
            processedAt: new Date()
          });
          
          successCount++;
          info(`Successfully retried outbox message: ${message.messageId}`);
          
        } catch (err) {
          failureCount++;
          error(`Failed to retry outbox message ${message.messageId}:`, err);
          
          // Increment attempts and update error
          const currentAttempts = message.attempts + 1;
          const updateData = {
            attempts: currentAttempts,
            lastError: err.message || 'Unknown error during retry'
          };
          
          // Check if max retries reached
          if (currentAttempts >= message.maxRetries) {
            updateData.status = 'failed';
            updateData.nextRetryAt = null;
            error(`Max retries reached for message ${message.messageId}`);
          } else {
            // Calculate next retry with exponential backoff
            const baseDelay = 60000; // 1 minute
            const maxDelay = 3600000; // 1 hour
            const delay = Math.min(baseDelay * Math.pow(2, currentAttempts), maxDelay);
            updateData.nextRetryAt = new Date(Date.now() + delay);
            updateData.status = 'retrying';
          }
          
          await updateOutboxMessageById(message._id, updateData);
        }
      }
      
      info(`Outbox retry processing completed: ${successCount} succeeded, ${failureCount} failed`);
      
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
}

// Schedule all recurring jobs
function scheduleJobs() {
  // Schedule job 1: Check for failure mails every 45 minutes
  agenda.every('45 minutes', 'failure mails');
  
  // Schedule job 2: Daily report at 8:00 AM
  agenda.every('0 8 * * *', 'report failures');
  
  // Schedule job 3: Process outbox retries every 2 minutes
  agenda.every('2 minutes', 'process outbox retries');
  
  info('All jobs scheduled successfully');
}

// Email template helper
const loadEmailTemplate = async (fileLocation, username, emailRows) => {
  try {
    const emailData = (await fs.readFile(fileLocation, 'utf8'))
      .replace('$adminName', username || 'Admin')
      .replace('$trData', emailRows || '');
    return emailData;
  } catch (err) {
    error('Error loading email template:', err);
    return `<p>Hello ${username || 'Admin'},</p><p>Failed email report:</p><table>${emailRows || ''}</table>`;
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