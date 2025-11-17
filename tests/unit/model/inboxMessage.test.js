/**
 * Inbox Message Model Unit Tests
 *
 * Tests for:
 * - saveMessage
 * - markProcessed
 * - markFailed
 * - isProcessed
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockInboxMessageModel = {
  updateOne: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn()
};

const mockModel = {
  InboxMessage: mockInboxMessageModel
};

// Use dynamic imports for ES modules
let InboxMessage;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    InboxMessage: mockInboxMessageModel
  }));

  InboxMessage = await import('../../../model/inboxMessage.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Inbox Message Model', () => {
  let inboxModel;

  beforeEach(() => {
    jest.clearAllMocks();
    mockInboxMessageModel.updateOne.mockClear();
    mockInboxMessageModel.findOne.mockClear();
    mockInboxMessageModel.find.mockClear();
    inboxModel = new InboxMessage.InboxModel();
  });

  describe('saveMessage', () => {
    it('should save message with upsert', async () => {
      // Arrange
      const messageData = {
        messageId: 'msg_123',
        eventType: 'merchant.created',
        aggregateId: 'merchant_123',
        data: { name: 'Test Merchant' },
        metadata: { receivedAt: new Date() }
      };

      mockInboxMessageModel.updateOne.mockResolvedValue({ upsertedCount: 1 });

      // Act
      await inboxModel.saveMessage(messageData);

      // Assert
      expect(mockInboxMessageModel.updateOne).toHaveBeenCalledWith(
        { messageId: messageData.messageId },
        {
          $setOnInsert: {
            messageId: messageData.messageId,
            eventType: messageData.eventType,
            aggregateId: messageData.aggregateId,
            data: messageData.data,
            metadata: messageData.metadata,
            receivedAt: expect.any(Date),
            processed: false,
            retryCount: 0
          }
        },
        { upsert: true }
      );
    });

    it('should not create duplicate if message already exists', async () => {
      // Arrange
      const messageData = {
        messageId: 'msg_123',
        eventType: 'merchant.created',
        aggregateId: 'merchant_123',
        data: {},
        metadata: {}
      };

      mockInboxMessageModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

      // Act
      await inboxModel.saveMessage(messageData);

      // Assert
      expect(mockInboxMessageModel.updateOne).toHaveBeenCalled();
    });
  });

  describe('markProcessed', () => {
    it('should mark message as processed', async () => {
      // Arrange
      const messageId = 'msg_123';

      mockInboxMessageModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      // Act
      await inboxModel.markProcessed(messageId);

      // Assert
      expect(mockInboxMessageModel.updateOne).toHaveBeenCalledWith(
        { messageId: messageId },
        {
          $set: {
            processed: true,
            processedAt: expect.any(Date),
            errorInfo: null
          }
        }
      );
    });
  });

  describe('markFailed', () => {
    it('should mark message as failed with error info', async () => {
      // Arrange
      const messageId = 'msg_123';
      const error = 'Processing failed';
      const retryCount = 2;

      mockInboxMessageModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      // Act
      await inboxModel.markFailed(messageId, error, retryCount);

      // Assert
      expect(mockInboxMessageModel.updateOne).toHaveBeenCalledWith(
        { messageId: messageId },
        {
          $set: {
            processed: false,
            errorInfo: error,
            retryCount: retryCount,
            lastAttemptAt: expect.any(Date)
          }
        }
      );
    });
  });

  describe('isProcessed', () => {
    it('should return true if message is processed', async () => {
      // Arrange
      const messageId = 'msg_123';
      const processedMessage = {
        _id: new mongoose.Types.ObjectId(),
        messageId: messageId,
        processed: true
      };

      mockInboxMessageModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(processedMessage)
      });

      // Act
      const result = await inboxModel.isProcessed(messageId);

      // Assert
      expect(mockInboxMessageModel.findOne).toHaveBeenCalledWith({
        messageId: messageId,
        processed: true
      });
      expect(result).toBe(true);
    });

    it('should return false if message is not processed', async () => {
      // Arrange
      const messageId = 'msg_123';

      mockInboxMessageModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      // Act
      const result = await inboxModel.isProcessed(messageId);

      // Assert
      expect(result).toBe(false);
    });
  });
});

