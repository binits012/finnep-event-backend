import { messageConsumer } from './messageConsumer.js';
import { handleMerchantMessage } from '../handlers/merchantHandler.js';
import { handleEventMessage } from '../handlers/eventHandler.js';
import { handleExternalTicketSalesMessage } from '../handlers/externalTicketSalesHandler.js';
import { handleSeatAvailabilityCheck } from '../handlers/seatAvailabilityHandler.js';
import { handleSeatedEventTicketCreated } from '../handlers/seatedEventTicketHandler.js';
import { handleSurveyMessage } from '../handlers/surveyHandler.js';
import { info, error, warn } from '../../model/logger.js';

// Track if queues have been set up to prevent duplicate setup
let isSetupComplete = false;

// Queue configuration - prefetch controls how many messages are processed concurrently
export const QUEUE_PREFETCH = 20;

const setupQueues = async () => {
    // Prevent duplicate queue setup
    if (isSetupComplete) {
        warn('Queue setup already completed, skipping duplicate setup');
        return;
    }

    try {
        info('Starting queue setup...');
        await messageConsumer.initialize();

        // Set up dead letter exchange (if not already exists, will use existing if it matches)
        // Note: Exchange type is 'topic' to match existing RabbitMQ configuration
        await messageConsumer.createExchange('event-merchant-dlx', 'topic', { durable: true });

        // Also assert on consume channel for binding
        if (messageConsumer.consumeChannel) {
            await messageConsumer.consumeChannel.assertExchange('event-merchant-dlx', 'topic', { durable: true });
        }

        // Set up dead letter queue for external-ticket-sales-queue (this microservice's responsibility)
        const externalTicketSalesDLQ = 'dlq.external-ticket-sales-queue.retry-1';
        try {
            await messageConsumer.setupQueue(externalTicketSalesDLQ, { durable: true });
            if (messageConsumer.consumeChannel) {
                await messageConsumer.consumeChannel.bindQueue(externalTicketSalesDLQ, 'event-merchant-dlx', externalTicketSalesDLQ);
                info(`Dead letter queue ${externalTicketSalesDLQ} set up and bound to event-merchant-dlx`);
            }
        } catch (err) {
            warn(`Warning setting up DLQ ${externalTicketSalesDLQ}: ${err.message}`);
        }

        // Set up merchant events queue consumption
        const merchantQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.merchant-events-queue.retry-1'
        };
        info('Setting up merchant-events-queue with options:', merchantQueueOptions);
        await messageConsumer.consumeQueue('merchant-events-queue', async (message) => {
            await handleMerchantMessage(message);
        }, merchantQueueOptions);

        // Set up event events queue consumption
        const eventQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.event-events-queue.retry-1'
        };
        info('Setting up event-events-queue with options:', eventQueueOptions);
        await messageConsumer.consumeQueue('event-events-queue', async (message) => {
            await handleEventMessage(message);
        }, eventQueueOptions);

        // Set up external ticket sales queue consumption
        const externalTicketSalesQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.external-ticket-sales-queue.retry-1'
        };
        info('Setting up external-ticket-sales-queue with options:', externalTicketSalesQueueOptions);
        await messageConsumer.consumeQueue('external-ticket-sales-queue', async (message) => {
            await handleExternalTicketSalesMessage(message);
        }, externalTicketSalesQueueOptions);

        // Set up seat availability check queue consumption
        const seatAvailabilityCheckQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.external.seat.availability.check.retry-1'
        };
        info('Setting up external.seat.availability.check queue with options:', seatAvailabilityCheckQueueOptions);
        await messageConsumer.consumeQueue('external.seat.availability.check', async (message) => {
            await handleSeatAvailabilityCheck(message);
        }, seatAvailabilityCheckQueueOptions);

        // Set up external seated event ticket created queue consumption
        const externalSeatedEventTicketQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.external.seated.event.ticket.retry-1'
        };
        info('Setting up external.seated.event.ticket queue with options:', externalSeatedEventTicketQueueOptions);
        await messageConsumer.consumeQueue('external.seated.event.ticket', async (message) => {
            await handleSeatedEventTicketCreated(message);
        }, externalSeatedEventTicketQueueOptions);

        // Survey events (queue created and bound by event-merchant-service plugin)
        const surveyEventsQueueOptions = {
            prefetch: QUEUE_PREFETCH,
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.survey-events-queue.retry-1'
        };
        info('Setting up survey-events-queue with options:', surveyEventsQueueOptions);
        await messageConsumer.consumeQueue('survey-events-queue', async (message) => {
            await handleSurveyMessage(message);
        }, surveyEventsQueueOptions);

        isSetupComplete = true;
        info('All queues set up and consuming messages');
    } catch (err) {
        error('Failed to setup queues', { error: err.message, stack: err.stack });
        // Reset flag on failure to allow retry
        isSetupComplete = false;
        throw err;
    }
};

export { setupQueues };
