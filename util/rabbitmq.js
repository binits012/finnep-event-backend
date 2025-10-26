import amqp from 'amqplib';
import {info, error, warn} from '../model/logger.js'; // Adjust path as needed

class RabbitMQConnection {
    constructor() {
        this.connection = null;
        this.channels = new Set(); // Track multiple channels
        this.config = {
            hostname: process.env.RABBITMQ_HOST || 'localhost',
            port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
            username: process.env.RABBITMQ_USERNAME || 'guest',
            password: process.env.RABBITMQ_PASSWORD || 'guest',
            vhost: process.env.RABBITMQ_VHOST || '/',
            heartbeat: parseInt(process.env.RABBITMQ_HEARTBEAT || '60', 10), // 60 seconds heartbeat
            // SSL options if enabled
            ...(process.env.RABBITMQ_SSL === 'true' ? {
                protocol: 'amqps',
                ssl: {
                    rejectUnauthorized: process.env.RABBITMQ_REJECT_UNAUTHORIZED !== 'false'
                }
            } : { protocol: 'amqp' })
        };
        info('RabbitMQ configuration initialized', {
            hostname: this.config.hostname,
            port: this.config.port,
            username: this.config.username,
            vhost: this.config.vhost,
            protocol: this.config.protocol,
            ssl: !!this.config.ssl
        });
        this.isConnecting = false;
        this.shouldReconnect = true;
    }

    async connect() {
        if (this.isConnecting || (this.connection && !this.connection.connection.closed)) return;

        this.isConnecting = true;
        try {
            info('Attempting to connect to RabbitMQ', { hostname: this.config.hostname, port: this.config.port });
            this.connection = await amqp.connect({
                hostname: this.config.hostname,
                port: this.config.port,
                username: this.config.username,
                password: this.config.password,
                vhost: this.config.vhost,
                protocol: this.config.protocol,
                ...(this.config.ssl ? { ssl: this.config.ssl } : {})
            });

            info('RabbitMQ connection established');
            this.connection.on('error', (err) => {
                error('RabbitMQ connection error', { error: err.message, stack: err.stack });
                this.handleConnectionLoss();
            });

            this.connection.on('close', () => {
                warn('RabbitMQ connection closed');
                this.handleConnectionLoss();
            });

            info('Successfully connected to RabbitMQ');
        } catch (err) {
            error('Failed to connect to RabbitMQ', { error: err.message, stack: err.stack });
            setTimeout(() => this.reconnect(), 5000);
        } finally {
            this.isConnecting = false;
        }
    }

    handleConnectionLoss() {
        this.connection = null;
        this.channels.clear(); // Clear all channel references
        if (this.shouldReconnect && !this.isConnecting) {
            info('Scheduling reconnection attempt in 5 seconds');
            setTimeout(() => this.connect(), 5000);
        }
    }

    async reconnect() {
        this.connection = null;
        this.channels.clear();
        if (!this.isConnecting) {
            info('Initiating manual reconnection');
            setTimeout(() => this.connect(), 5000);
        }
    }

    async getConnection() {
        if (!this.connection || this.connection.connection.closed) {
            await this.connect();
        }
        return this.connection;
    }

    async getChannel() {
        const connection = await this.getConnection();
        if (!connection) {
            throw new Error('No connection available');
        }

        try {
            const channel = await connection.createChannel();
            this.channels.add(channel);

            // Handle channel-specific errors
            channel.on('error', (err) => {
                error('RabbitMQ channel error', { error: err.message });
                this.channels.delete(channel);
            });

            channel.on('close', () => {
                info('RabbitMQ channel closed');
                this.channels.delete(channel);
            });

            return channel;
        } catch (err) {
            error('Failed to create channel', { error: err.message });
            throw err;
        }
    }

    async close() {
        this.shouldReconnect = false;
        info('Closing RabbitMQ connection');

        // Close all channels first
        for (const channel of this.channels) {
            try {
                if (!channel.closed) {
                    await channel.close();
                }
            } catch (err) {
                warn('Error closing channel', { error: err.message });
            }
        }
        this.channels.clear();

        if (this.connection && !this.connection.connection.closed) {
            await this.connection.close();
        }
    }

    async disconnect() {
        await this.close();
    }
}

const rabbitMQ = new RabbitMQConnection();
export { RabbitMQConnection, rabbitMQ };
