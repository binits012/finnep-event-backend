import { messageConsumer } from './messageConsumer.js';
import { handleMerchantMessage } from '../handlers/merchantHandler.js';
import { handleEventMessage } from '../handlers/eventHandler.js';
import { info, error } from '../../model/logger.js';

const setupQueues = async () => {
    try {
        await messageConsumer.initialize();
        
        // Set up merchant events queue consumption
        // (Must match existing queue configuration with dead letter exchange)
        const queueOptions = { 
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.merchant-events-queue.retry-1'
        };
        info('Setting up merchant-events-queue with options:', queueOptions);
        await messageConsumer.consumeQueue('merchant-events-queue', async (message) => {
            await handleMerchantMessage(message);
        }, queueOptions);

        // Set up event events queue consumption  
        const eventQueueOptions = { 
            deadLetterExchange: 'event-merchant-dlx',
            deadLetterRoutingKey: 'dlq.event-events-queue.retry-1'
        };
        info('Setting up event-events-queue with options:', eventQueueOptions);
        await messageConsumer.consumeQueue('event-events-queue', async (message) => {
            await handleEventMessage(message);
        }, eventQueueOptions);

        info('All queues set up and consuming messages');
    } catch (err) {
        error('Failed to setup queues', { error: err.message, stack: err.stack });
        throw err;
    }
};

export { setupQueues };
