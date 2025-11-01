import { messageConsumer } from './messageConsumer.js';
import { handleMerchantMessage } from '../handlers/merchantHandler.js';
import { handleEventMessage } from '../handlers/eventHandler.js';
import { info, error, warn } from '../../model/logger.js';

// Track if queues have been set up to prevent duplicate setup
let isSetupComplete = false;

// Queue configuration - prefetch controls how many messages are processed concurrently
export const QUEUE_PREFETCH = 10;

const setupQueues = async () => {
    // Prevent duplicate queue setup
    if (isSetupComplete) {
        warn('Queue setup already completed, skipping duplicate setup');
        return;
    }

    try {
        info('Starting queue setup...');
        await messageConsumer.initialize();

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
