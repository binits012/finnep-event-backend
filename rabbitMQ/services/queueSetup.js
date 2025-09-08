import { messageConsumer } from './messageConsumer.js';
import { handleMerchantMessage } from '../handlers/merchantHandler.js';
import { handleEventMessage } from '../handlers/eventHandler.js';
import { info, error } from '../../model/logger.js';

const setupQueues = async () => {
    try {
        await messageConsumer.initialize();
        
        // Set up merchant events queue consumption
        await messageConsumer.consumeQueue('merchant-events-queue', async (message) => {
            await handleMerchantMessage(message);
        });

        // Set up event events queue consumption  
        await messageConsumer.consumeQueue('event-events-queue', async (message) => {
            await handleEventMessage(message);
        });

        info('All queues set up and consuming messages');
    } catch (err) {
        error('Failed to setup queues', { error: err.message, stack: err.stack });
        throw err;
    }
};

export { setupQueues };
