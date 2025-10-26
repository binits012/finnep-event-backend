import { rabbitMQ } from '../../util/rabbitmq.js';
import { info, error, warn } from '../../model/logger.js';

class MessageConsumer {
    constructor() {
        this.publishChannel = null;
        this.consumeChannel = null;
        this.isInitialized = false;
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
            const publishChannelInvalid = !this.publishChannel || !this.publishChannel.connection || this.publishChannel.connection.closed || this.publishChannel.connection.destroyed;
            const consumeChannelInvalid = !this.consumeChannel || !this.consumeChannel.connection || this.consumeChannel.connection.closed || this.consumeChannel.connection.destroyed;

            if (publishChannelInvalid || consumeChannelInvalid) {
                this.isInitialized = false;
                info('Channels not ready or closed, initializing...');
                await this.initialize();
            }

            if (!this.publishChannel || !this.consumeChannel) {
                throw new Error('Channels are still null after initialization attempt');
            }
        } catch (err) {
            error('Error ensuring channels are ready:', err);
            throw err;
        }
    }

    async consumeQueue(queueName, handler, options = {}) {
        await this.ensureChannelsReady();

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

        this.consumeChannel.consume(queueName, async (msg) => {
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
        try {
            await this.ensureChannelsReady();

            const { exchangeType = 'direct', durable = true } = options; 

            // Declare the exchange if it doesn't exist
            await this.publishChannel.assertExchange(exchangeName, exchangeType, { durable });

            // Publish to exchange with routing key
            this.publishChannel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(message)), {
                persistent: true,
                ...options.publishOptions
            });

            info(`Published message to exchange: ${exchangeName} with routing key: ${routingKey}`);
        } catch (err) {
            error(`Failed to publish to exchange: ${exchangeName}`, {
                error: err.message,
                stack: err.stack,
                exchangeName,
                routingKey
            });
            // Reset channels to force reconnection
            this.publishChannel = null;
            this.consumeChannel = null;
            this.isInitialized = false;
            throw err;
        }
    }

    async consumeFromExchange(exchangeName, queueName, routingKey, handler, options = {}) {
        await this.ensureChannelsReady();

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

        this.consumeChannel.consume(queueName, async (msg) => {
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

async function ensureChannel() {
    if (!this.channel || this.channel.connection.destroyed) {
        await this.initialize(); // or your channel init logic
    }
}

export async function publishToExchange(exchange, routingKey, message, options) {
    await ensureChannel.call(this); // Ensure channel is open

    try {
        await this.channel.assertExchange(exchange, options.exchangeType || 'topic', { durable: true });
        this.channel.publish(
            exchange,
            routingKey,
            Buffer.from(JSON.stringify(message)),
            options.publishOptions || {}
        );
    } catch (err) {
        error('Failed to publish to exchange:', err);
        // Optionally, try to re-initialize and retry once
        if (err.message.includes('Channel closed')) {
            await this.initialize();
            // Retry publish once
            await this.channel.assertExchange(exchange, options.exchangeType || 'topic', { durable: true });
            this.channel.publish(
                exchange,
                routingKey,
                Buffer.from(JSON.stringify(message)),
                options.publishOptions || {}
            );
        } else {
            throw err;
        }
    }
}

const messageConsumer = new MessageConsumer();
export { MessageConsumer, messageConsumer };
