/**
 * Message Consumer Unit Tests
 *
 * Tests for:
 * - initialize
 * - ensureChannelsReady
 * - consumeQueue
 * - publishToExchange
 * - setupQueue
 * - createExchange
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockRabbitMQ = {
  getChannel: jest.fn(),
  connect: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Use dynamic imports for ES modules
let messageConsumer;
let rabbitMQ;
let logger;

beforeAll(async () => {
  // Use absolute paths for mocking
  const rabbitmqPath = resolve(__dirname, '../../../../util/rabbitmq.js');
  const loggerPath = resolve(__dirname, '../../../../model/logger.js');

  jest.unstable_mockModule(rabbitmqPath, () => ({
    rabbitMQ: mockRabbitMQ
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    info: mockLogger.info,
    error: mockLogger.error,
    warn: mockLogger.warn
  }));

  messageConsumer = await import('../../../../rabbitMQ/services/messageConsumer.js');
  rabbitMQ = await import('../../../../util/rabbitmq.js');
  logger = await import('../../../../model/logger.js');
});

describe('Message Consumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRabbitMQ.getChannel.mockClear();
    mockRabbitMQ.connect.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  describe('initialize', () => {
    it('should initialize publish and consume channels', async () => {
      // Arrange
      const mockPublishChannel = {
        connection: { closed: false }
      };
      const mockConsumeChannel = {
        connection: { closed: false }
      };

      mockRabbitMQ.getChannel
        .mockResolvedValueOnce(mockPublishChannel)
        .mockResolvedValueOnce(mockConsumeChannel);

      // Act
      await messageConsumer.messageConsumer.initialize();

      // Assert
      expect(mockRabbitMQ.getChannel).toHaveBeenCalledTimes(2);
      expect(messageConsumer.messageConsumer.isInitialized).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      // Arrange
      const mockPublishChannel = {
        connection: { closed: false }
      };
      const mockConsumeChannel = {
        connection: { closed: false }
      };

      messageConsumer.messageConsumer.isInitialized = true;
      messageConsumer.messageConsumer.publishChannel = mockPublishChannel;
      messageConsumer.messageConsumer.consumeChannel = mockConsumeChannel;

      // Act
      await messageConsumer.messageConsumer.initialize();

      // Assert
      expect(mockRabbitMQ.getChannel).not.toHaveBeenCalled();
    });

    it('should throw error if channel creation fails', async () => {
      // Arrange
      // Reset initialization state
      messageConsumer.messageConsumer.isInitialized = false;
      messageConsumer.messageConsumer.publishChannel = null;
      messageConsumer.messageConsumer.consumeChannel = null;

      // Mock getChannel to return null (simulating failure)
      mockRabbitMQ.getChannel.mockResolvedValue(null);

      // Act & Assert
      await expect(
        messageConsumer.messageConsumer.initialize()
      ).rejects.toThrow('Failed to get RabbitMQ channels');
    });
  });

  describe('ensureChannelsReady', () => {
    it('should re-initialize if channels are closed', async () => {
      // Arrange
      const mockPublishChannel = {
        connection: { closed: true }
      };
      const mockConsumeChannel = {
        connection: { closed: true }
      };

      messageConsumer.messageConsumer.publishChannel = mockPublishChannel;
      messageConsumer.messageConsumer.consumeChannel = mockConsumeChannel;
      messageConsumer.messageConsumer.isInitialized = true;

      const newPublishChannel = {
        connection: { closed: false }
      };
      const newConsumeChannel = {
        connection: { closed: false }
      };

      mockRabbitMQ.getChannel
        .mockResolvedValueOnce(newPublishChannel)
        .mockResolvedValueOnce(newConsumeChannel);

      // Act
      await messageConsumer.messageConsumer.ensureChannelsReady();

      // Assert
      expect(mockRabbitMQ.getChannel).toHaveBeenCalled();
    });
  });

  describe('consumeQueue', () => {
    it('should set up queue consumer', async () => {
      // Arrange
      const queueName = 'test-queue';
      const handler = jest.fn();
      const options = {
        durable: true,
        prefetch: 1
      };

      const mockPublishChannel = {
        connection: { closed: false },
        assertQueue: jest.fn().mockResolvedValue({ queue: queueName }),
        consume: jest.fn().mockResolvedValue({ consumerTag: 'tag_123' })
      };
      const mockConsumeChannel = {
        connection: { closed: false },
        assertQueue: jest.fn().mockResolvedValue({ queue: queueName }),
        prefetch: jest.fn().mockResolvedValue(undefined),
        consume: jest.fn().mockResolvedValue({ consumerTag: 'tag_123' })
      };

      messageConsumer.messageConsumer.publishChannel = mockPublishChannel;
      messageConsumer.messageConsumer.consumeChannel = mockConsumeChannel;
      messageConsumer.messageConsumer.isInitialized = true;

      // Act
      await messageConsumer.messageConsumer.consumeQueue(queueName, handler, options);

      // Assert
      expect(mockConsumeChannel.assertQueue).toHaveBeenCalled();
      expect(mockConsumeChannel.consume).toHaveBeenCalled();
    });

    it('should prevent duplicate consumers', async () => {
      // Arrange
      const queueName = 'test-queue';
      const handler = jest.fn();

      messageConsumer.messageConsumer.activeConsumers.add(queueName);

      const mockConsumeChannel = {
        connection: { closed: false }
      };

      messageConsumer.messageConsumer.consumeChannel = mockConsumeChannel;
      messageConsumer.messageConsumer.isInitialized = true;

      // Act
      await messageConsumer.messageConsumer.consumeQueue(queueName, handler);

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already active')
      );
    });
  });

  describe('publishToExchange', () => {
    it('should publish message to exchange', async () => {
      // Arrange
      const exchange = 'test-exchange';
      const routingKey = 'test.routing.key';
      const messageBody = { data: 'test' };
      const options = {
        exchangeType: 'topic',
        publishOptions: {
          persistent: true
        }
      };

      const mockPublishChannel = {
        connection: { closed: false },
        assertExchange: jest.fn().mockResolvedValue({}),
        publish: jest.fn().mockReturnValue(true)
      };

      messageConsumer.messageConsumer.publishChannel = mockPublishChannel;
      messageConsumer.messageConsumer.isInitialized = true;

      // Act
      await messageConsumer.messageConsumer.publishToExchange(
        exchange,
        routingKey,
        messageBody,
        options
      );

      // Assert
      expect(mockPublishChannel.assertExchange).toHaveBeenCalled();
      expect(mockPublishChannel.publish).toHaveBeenCalled();
    });
  });
});

