/**
 * External Ticket Sales Request Service Unit Tests
 *
 * Tests for:
 * - requestExternalTicketSales
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockMessageConsumer = {
  publishToExchange: jest.fn()
};

const mockOutboxMessage = {
  createOutboxMessage: jest.fn(),
  markMessageAsSent: jest.fn(),
  markMessageAsFailed: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn()
};

// Use dynamic imports for ES modules
let externalTicketSalesRequest;
let messageConsumer;
let outboxMessage;
let logger;

beforeAll(async () => {
  // Use absolute paths for mocking
  // Test file is at: tests/unit/services/externalTicketSalesRequest.test.js
  // So we need to go up 3 levels to reach root, then into the target directories
  const messageConsumerPath = resolve(__dirname, '../../../rabbitMQ/services/messageConsumer.js');
  const outboxMessagePath = resolve(__dirname, '../../../model/outboxMessage.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(messageConsumerPath, () => ({
    messageConsumer: mockMessageConsumer
  }));

  jest.unstable_mockModule(outboxMessagePath, () => ({
    createOutboxMessage: mockOutboxMessage.createOutboxMessage,
    markMessageAsSent: mockOutboxMessage.markMessageAsSent,
    markMessageAsFailed: mockOutboxMessage.markMessageAsFailed
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    info: mockLogger.info,
    error: mockLogger.error
  }));

  externalTicketSalesRequest = await import('../../../services/externalTicketSalesRequest.js');
  messageConsumer = await import('../../../rabbitMQ/services/messageConsumer.js');
  outboxMessage = await import('../../../model/outboxMessage.js');
  logger = await import('../../../model/logger.js');
});

describe('External Ticket Sales Request Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessageConsumer.publishToExchange.mockClear();
    mockOutboxMessage.createOutboxMessage.mockClear();
    mockOutboxMessage.markMessageAsSent.mockClear();
    mockOutboxMessage.markMessageAsFailed.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
  });

  describe('requestExternalTicketSales', () => {
    it('should publish request message to exchange', async () => {
      // Arrange
      const externalEventId = 'ext_event_123';
      const externalMerchantId = 'merchant_123';

      const mockOutboxMessageData = {
        _id: '507f1f77bcf86cd799439011',
        messageId: 'msg_123',
        correlationId: 'corr_123'
      };

      mockOutboxMessage.createOutboxMessage.mockResolvedValue(mockOutboxMessageData);
      mockMessageConsumer.publishToExchange.mockResolvedValue(undefined);
      mockOutboxMessage.markMessageAsSent.mockResolvedValue(true);

      // Act
      const result = await externalTicketSalesRequest.requestExternalTicketSales(
        externalEventId,
        externalMerchantId
      );

      // Assert
      expect(mockOutboxMessage.createOutboxMessage).toHaveBeenCalled();
      expect(mockMessageConsumer.publishToExchange).toHaveBeenCalled();
      expect(mockOutboxMessage.markMessageAsSent).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.messageId).toBeDefined();
      expect(result.correlationId).toBeDefined();
    });

    it('should handle publish errors and mark as failed', async () => {
      // Arrange
      const externalEventId = 'ext_event_123';
      const externalMerchantId = 'merchant_123';

      const mockOutboxMessageData = {
        _id: '507f1f77bcf86cd799439011',
        messageId: 'msg_123'
      };

      const mockError = new Error('Publish failed');

      mockOutboxMessage.createOutboxMessage.mockResolvedValue(mockOutboxMessageData);
      mockMessageConsumer.publishToExchange.mockRejectedValue(mockError);
      mockOutboxMessage.markMessageAsFailed.mockResolvedValue(true);

      // Act & Assert
      await expect(
        externalTicketSalesRequest.requestExternalTicketSales(
          externalEventId,
          externalMerchantId
        )
      ).rejects.toThrow('Publish failed');

      expect(mockOutboxMessage.markMessageAsFailed).toHaveBeenCalled();
    });

    it('should generate unique message and correlation IDs', async () => {
      // Arrange
      const externalEventId = 'ext_event_123';
      const externalMerchantId = 'merchant_123';

      const mockOutboxMessageData = {
        _id: '507f1f77bcf86cd799439011',
        messageId: 'msg_123',
        correlationId: 'corr_123'
      };

      mockOutboxMessage.createOutboxMessage.mockResolvedValue(mockOutboxMessageData);
      mockMessageConsumer.publishToExchange.mockResolvedValue(undefined);
      mockOutboxMessage.markMessageAsSent.mockResolvedValue(true);

      // Act
      const result1 = await externalTicketSalesRequest.requestExternalTicketSales(
        externalEventId,
        externalMerchantId
      );
      const result2 = await externalTicketSalesRequest.requestExternalTicketSales(
        externalEventId,
        externalMerchantId
      );

      // Assert
      // Each request should have unique IDs
      expect(result1.messageId).not.toBe(result2.messageId);
      expect(result1.correlationId).not.toBe(result2.correlationId);
    });
  });
});

