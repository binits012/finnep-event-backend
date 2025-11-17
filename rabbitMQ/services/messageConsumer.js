import { rabbitMQ } from '../../util/rabbitmq.js';
import { info, error, warn } from '../../model/logger.js';

class MessageConsumer {
    constructor() {
        this.publishChannel = null;
        this.consumeChannel = null;
        this.isInitialized = false;
        this.activeConsumers = new Set(); // Track active consumer tags to prevent duplicates
    }

    async initialize() {
        // Avoid re-initialization if already done
        if (this.isInitialized && this.publishChannel && this.consumeChannel) {
            return;
        }

        try {
            info('Initializing MessageConsumer channels...');

            // Create separate channels for publishing and consuming

            this.publishChannel = await rabbitMQ.getChannel();
            this.consumeChannel = await rabbitMQ.getChannel();

            if (!this.publishChannel || !this.consumeChannel) {
                throw new Error('Failed to get RabbitMQ channels');
            }

            this.isInitialized = true;
            info('MessageConsumer channels initialized successfully');
        } catch (err) {
            error('Failed to initialize MessageConsumer channels', { error: err.message, stack: err.stack });
            this.isInitialized = false;
            throw err;
        }
    }

    async ensureChannelsReady() {
        try {
            // Check if channels exist and their connections are open
            const publishChannelInvalid = !this.publishChannel ||
                !this.publishChannel.connection ||
                this.publishChannel.connection.closed ||
                this.publishChannel.connection.destroyed;

            const consumeChannelInvalid = !this.consumeChannel ||
                !this.consumeChannel.connection ||
                this.consumeChannel.connection.closed ||
                this.consumeChannel.connection.destroyed;

            if (publishChannelInvalid || consumeChannelInvalid) {
                this.isInitialized = false;
                // Clear active consumers since channels are being re-initialized
                this.activeConsumers.clear();
                info('Channels not ready or closed, clearing consumers and initializing...');
                await this.initialize();
            }

            if (!this.publishChannel || !this.consumeChannel) {
                throw new Error('Channels are still null after initialization attempt');
            }

            // Double-check channels have valid connections after initialization
            if (!this.publishChannel.connection || !this.consumeChannel.connection ||
                this.publishChannel.connection.closed || this.consumeChannel.connection.closed) {
                throw new Error('Channels have invalid connections after initialization');
            }
        } catch (err) {
            error('Error ensuring channels are ready:', err);
            // Reset state to force re-initialization on next attempt
            this.publishChannel = null;
            this.consumeChannel = null;
            this.isInitialized = false;
            throw err;
        }
    }

    async consumeQueue(queueName, handler, options = {}) {
        await this.ensureChannelsReady();

        // Prevent duplicate consumers for the same queue
        if (this.activeConsumers.has(queueName)) {
            warn(`Consumer for queue ${queueName} already active, skipping setup`);
            return;
        }

        const { durable = true, prefetch = 1, deadLetterExchange, deadLetterRoutingKey } = options;

        // Configure queue options with dead letter exchange if provided
        const queueOptions = { durable };
        if (deadLetterExchange) {
            queueOptions.arguments = {
                'x-dead-letter-exchange': deadLetterExchange
            };
            if (deadLetterRoutingKey) {
                queueOptions.arguments['x-dead-letter-routing-key'] = deadLetterRoutingKey;
            }
        }

        info(`Creating queue ${queueName} with options:`, queueOptions);
        await this.consumeChannel.assertQueue(queueName, queueOptions);
        await this.consumeChannel.prefetch(prefetch);

        info(`Starting to consume queue: ${queueName}`);

        const { consumerTag } = await this.consumeChannel.consume(queueName, async (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    info(`Received message from ${queueName}`, { message: content });

                    await handler(content);
                    this.consumeChannel.ack(msg);
                } catch (err) {
                    error(`Error processing message from ${queueName}`, { error: err.message, stack: err.stack });
                    this.consumeChannel.nack(msg, false, false); // Don't requeue
                }
            }
        });

        // Track this consumer to prevent duplicates
        this.activeConsumers.add(queueName);
        info(`Consumer registered for queue ${queueName} with tag: ${consumerTag}`);
    }

    async publishMessage(queueName, message) {
        await this.ensureChannelsReady();

        await this.publishChannel.assertQueue(queueName, { durable: true });
        this.publishChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
            persistent: true
        });

        info(`Published message to queue: ${queueName}`);
    }

    async publishToExchange(exchangeName, routingKey, message, options = {}) {
        const maxRetries = 2;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Ensure channels are ready before each attempt
                await this.ensureChannelsReady();

                // Double-check channel has valid connection right before use
                if (!this.publishChannel.connection || this.publishChannel.connection.closed) {
                    throw new Error('Publish channel connection is invalid');
                }

                const { exchangeType = 'direct', durable = true } = options;

                // Declare the exchange if it doesn't exist
                await this.publishChannel.assertExchange(exchangeName, exchangeType, { durable });

                // Publish to exchange with routing key
                const published = this.publishChannel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(message)), {
                    persistent: true,
                    ...options.publishOptions
                });

                if (!published) {
                    warn(`Channel buffer full when publishing to exchange: ${exchangeName}, routing key: ${routingKey}`);
                    // Wait a bit and retry
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
                        continue;
                    }
                }

                info(`Published message to exchange: ${exchangeName} with routing key: ${routingKey}`);
                return; // Success, exit retry loop
            } catch (err) {
                lastError = err;

                // Check if it's a channel closed error
                const isChannelClosed = err.message && (
                    err.message.includes('Channel closed') ||
                    err.message.includes('IllegalOperationError') ||
                    err.message.includes('closed')
                );

                if (isChannelClosed || err.message.includes('Publish channel is closed')) {
                    error(`Channel closed error on attempt ${attempt + 1}/${maxRetries + 1} for exchange: ${exchangeName}`, {
                        error: err.message,
                        exchangeName,
                        routingKey
                    });

                    // Reset channels to force reconnection
                    this.publishChannel = null;
                    this.consumeChannel = null;
                    this.isInitialized = false;

                    // Wait before retry (exponential backoff)
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, attempt)));
                        continue;
                    }
                } else {
                    // Non-channel error, don't retry
                    error(`Failed to publish to exchange: ${exchangeName}`, {
                        error: err.message,
                        stack: err.stack,
                        exchangeName,
                        routingKey
                    });
                    throw err;
                }
            }
        }

        // All retries exhausted
        error(`Failed to publish to exchange after ${maxRetries + 1} attempts: ${exchangeName}`, {
            error: lastError?.message,
            exchangeName,
            routingKey
        });
        throw lastError;
    }

    async consumeFromExchange(exchangeName, queueName, routingKey, handler, options = {}) {
        await this.ensureChannelsReady();

        // Prevent duplicate consumers for the same queue
        const consumerKey = `${exchangeName}:${queueName}:${routingKey}`;
        if (this.activeConsumers.has(consumerKey)) {
            warn(`Consumer for exchange ${exchangeName}, queue ${queueName}, routing key ${routingKey} already active, skipping setup`);
            return;
        }

        const {
            exchangeType = 'direct',
            durable = true,
            prefetch = 1,
            queueOptions = {}
        } = options;

        // Declare exchange and queue
        await this.consumeChannel.assertExchange(exchangeName, exchangeType, { durable });
        await this.consumeChannel.assertQueue(queueName, { durable, ...queueOptions });

        // Bind queue to exchange with routing key
        await this.consumeChannel.bindQueue(queueName, exchangeName, routingKey);
        await this.consumeChannel.prefetch(prefetch);

        info(`Starting to consume from exchange: ${exchangeName}, queue: ${queueName}, routing key: ${routingKey}`);

        const { consumerTag } = await this.consumeChannel.consume(queueName, async (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    info(`Received message from exchange ${exchangeName}`, {
                        message: content,
                        routingKey: msg.fields.routingKey
                    });

                    await handler(content, msg.fields.routingKey);
                    this.consumeChannel.ack(msg);
                } catch (err) {
                    error(`Error processing message from exchange ${exchangeName}`, {
                        error: err.message,
                        stack: err.stack
                    });
                    this.consumeChannel.nack(msg, false, false);
                }
            }
        });

        // Track this consumer to prevent duplicates
        this.activeConsumers.add(consumerKey);
        info(`Consumer registered for exchange ${exchangeName}, queue ${queueName} with tag: ${consumerTag}`);
    }

    async setupQueue(queueName, options = {}) {
        await this.ensureChannelsReady();

        const { durable = true, prefetch = 1 } = options;

        // Declare the queue if it doesn't exist
        await this.consumeChannel.assertQueue(queueName, { durable });
        await this.consumeChannel.prefetch(prefetch);

        info(`Queue ${queueName} set up with options`, { durable, prefetch });
    }

    async createExchange(exchangeName, exchangeType = 'direct', options = {}) {
        await this.ensureChannelsReady();

        const { durable = true } = options;

        await this.publishChannel.assertExchange(exchangeName, exchangeType, { durable });
        info(`Exchange ${exchangeName} created with type ${exchangeType}`);
    }
}

const messageConsumer = new MessageConsumer();
export { MessageConsumer, messageConsumer };
