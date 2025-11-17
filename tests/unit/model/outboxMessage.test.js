/**
 * Outbox Message Model Unit Tests
 *
 * Tests for:
 * - createOutboxMessage
 * - createOutboxMessagesBatch
 * - getOutboxMessageById
 * - getOutboxMessageByMessageId
 * - getAllOutboxMessages
 * - updateOutboxMessageById
 * - markMessageAsSent
 * - markMessageAsFailed
 * - getPendingMessages
 * - deleteOutboxMessageById
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockOutboxMessageModel = jest.fn();
mockOutboxMessageModel.find = jest.fn();
mockOutboxMessageModel.findById = jest.fn();
mockOutboxMessageModel.findOne = jest.fn();
mockOutboxMessageModel.findOneAndUpdate = jest.fn();
mockOutboxMessageModel.findByIdAndUpdate = jest.fn();
mockOutboxMessageModel.findByIdAndDelete = jest.fn();
mockOutboxMessageModel.insertMany = jest.fn();
mockOutboxMessageModel.deleteOne = jest.fn();

const mockModel = {
  OutboxMessage: mockOutboxMessageModel
};

const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

// Use dynamic imports for ES modules
let OutboxMessage;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    OutboxMessage: mockOutboxMessageModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error,
    info: mockLogger.info
  }));

  OutboxMessage = await import('../../../model/outboxMessage.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Outbox Message Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutboxMessageModel.mockClear();
    mockOutboxMessageModel.find.mockClear();
    mockOutboxMessageModel.findById.mockClear();
    mockOutboxMessageModel.findOne.mockClear();
    mockOutboxMessageModel.findOneAndUpdate.mockClear();
    mockOutboxMessageModel.findByIdAndUpdate.mockClear();
    mockOutboxMessageModel.findByIdAndDelete.mockClear();
    mockOutboxMessageModel.insertMany.mockClear();
    mockOutboxMessageModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
  });

  describe('createOutboxMessage', () => {
    it('should create a new outbox message', async () => {
      // Arrange
      const messageData = {
        messageId: 'msg_123',
        exchange: 'test-exchange',
        routingKey: 'test.routing.key',
        messageBody: { data: 'test' },
        status: 'pending'
      };

      const savedMessageData = {
        _id: new mongoose.Types.ObjectId(),
        ...messageData
      };

      const mockSavedMessage = {
        _id: savedMessageData._id,
        ...messageData,
        save: jest.fn().mockResolvedValue(savedMessageData)
      };

      mockOutboxMessageModel.mockImplementation(() => mockSavedMessage);

      // Act
      const result = await OutboxMessage.createOutboxMessage(messageData);

      // Assert
      expect(mockOutboxMessageModel).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.messageId).toBe(messageData.messageId);
    });

    it('should handle creation errors', async () => {
      // Arrange
      const messageData = {
        messageId: 'msg_123',
        exchange: 'test-exchange'
      };

      const mockError = new Error('Creation failed');
      const mockMessageInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockOutboxMessageModel.mockImplementation(() => mockMessageInstance);

      // Act & Assert
      await expect(
        OutboxMessage.createOutboxMessage(messageData)
      ).rejects.toThrow();
    });
  });

  describe('createOutboxMessagesBatch', () => {
    it('should create multiple outbox messages', async () => {
      // Arrange
      const messagesArray = [
        {
          messageId: 'msg_1',
          exchange: 'test-exchange',
          routingKey: 'test.1'
        },
        {
          messageId: 'msg_2',
          exchange: 'test-exchange',
          routingKey: 'test.2'
        }
      ];

      const mockInsertedMessages = messagesArray.map((msg, index) => ({
        _id: new mongoose.Types.ObjectId(),
        ...msg
      }));

      mockOutboxMessageModel.insertMany.mockResolvedValue(mockInsertedMessages);

      // Act
      const result = await OutboxMessage.createOutboxMessagesBatch(messagesArray);

      // Assert
      expect(mockOutboxMessageModel.insertMany).toHaveBeenCalledWith(
        messagesArray,
        {
          ordered: false,
          lean: true
        }
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should handle batch insert errors gracefully', async () => {
      // Arrange
      const messagesArray = [
        { messageId: 'msg_1', exchange: 'test-exchange' }
      ];

      const mockError = {
        name: 'MongoBulkWriteError',
        writeErrors: [{ message: 'Duplicate key' }],
        insertedDocs: []
      };

      mockOutboxMessageModel.insertMany.mockRejectedValue(mockError);

      // Act
      const result = await OutboxMessage.createOutboxMessagesBatch(messagesArray);

      // Assert
      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw error for empty array', async () => {
      // Arrange
      const messagesArray = [];

      // Act & Assert
      await expect(
        OutboxMessage.createOutboxMessagesBatch(messagesArray)
      ).rejects.toThrow('messagesArray must be a non-empty array');
    });
  });

  describe('getOutboxMessageById', () => {
    it('should retrieve outbox message by ID', async () => {
      // Arrange
      const messageId = new mongoose.Types.ObjectId();
      const mockMessage = {
        _id: messageId,
        messageId: 'msg_123',
        status: 'pending'
      };

      mockOutboxMessageModel.findById.mockResolvedValue(mockMessage);

      // Act
      const result = await OutboxMessage.getOutboxMessageById(messageId);

      // Assert
      expect(mockOutboxMessageModel.findById).toHaveBeenCalledWith(messageId);
      expect(result).toBeDefined();
      expect(result._id).toEqual(messageId);
    });
  });

  describe('getOutboxMessageByMessageId', () => {
    it('should retrieve outbox message by messageId', async () => {
      // Arrange
      const messageId = 'msg_123';
      const mockMessage = {
        _id: new mongoose.Types.ObjectId(),
        messageId: messageId,
        status: 'pending'
      };

      mockOutboxMessageModel.findOne.mockResolvedValue(mockMessage);

      // Act
      const result = await OutboxMessage.getOutboxMessageByMessageId(messageId);

      // Assert
      expect(mockOutboxMessageModel.findOne).toHaveBeenCalledWith({ messageId: messageId });
      expect(result).toBeDefined();
      expect(result.messageId).toBe(messageId);
    });
  });

  describe('getAllOutboxMessages', () => {
    it('should retrieve all outbox messages with default filter', async () => {
      // Arrange
      const mockMessages = [
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg_1',
          status: 'pending'
        },
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg_2',
          status: 'sent'
        }
      ];

      mockOutboxMessageModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockMessages)
        })
      });

      // Act
      const result = await OutboxMessage.getAllOutboxMessages();

      // Assert
      expect(mockOutboxMessageModel.find).toHaveBeenCalledWith({});
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should apply filter, limit, and skip', async () => {
      // Arrange
      const filter = { status: 'pending' };
      const limit = 10;
      const skip = 5;

      mockOutboxMessageModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([])
            })
          })
        })
      });

      // Act
      const result = await OutboxMessage.getAllOutboxMessages(filter, limit, skip);

      // Assert
      expect(mockOutboxMessageModel.find).toHaveBeenCalledWith(filter);
      expect(result).toBeDefined();
    });
  });

  describe('updateOutboxMessageById', () => {
    it('should update outbox message', async () => {
      // Arrange
      const messageId = new mongoose.Types.ObjectId();
      const updateData = {
        status: 'sent',
        sentAt: new Date()
      };

      const updatedMessage = {
        _id: messageId,
        ...updateData
      };

      mockOutboxMessageModel.findByIdAndUpdate.mockResolvedValue(updatedMessage);

      // Act
      const result = await OutboxMessage.updateOutboxMessageById(messageId, updateData);

      // Assert
      expect(mockOutboxMessageModel.findByIdAndUpdate).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining(updateData),
        { new: true, runValidators: true }
      );
      expect(result).toBeDefined();
      expect(result.status).toBe('sent');
    });
  });

  describe('markMessageAsSent', () => {
    it('should mark message as sent', async () => {
      // Arrange
      const messageId = new mongoose.Types.ObjectId();

      const updatedMessage = {
        _id: messageId,
        status: 'sent',
        sentAt: new Date()
      };

      mockOutboxMessageModel.findByIdAndUpdate.mockResolvedValue(updatedMessage);

      // Act
      const result = await OutboxMessage.markMessageAsSent(messageId);

      // Assert
      expect(mockOutboxMessageModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.status).toBe('sent');
    });
  });

  describe('markMessageAsFailed', () => {
    it('should mark message as failed', async () => {
      // Arrange
      const messageId = new mongoose.Types.ObjectId();
      const errorMessage = 'Publish failed';

      const updatedMessage = {
        _id: messageId,
        status: 'failed',
        errorMessage: errorMessage,
        attempts: 1
      };

      mockOutboxMessageModel.findByIdAndUpdate.mockResolvedValue(updatedMessage);

      // Act
      const result = await OutboxMessage.markMessageAsFailed(messageId, errorMessage);

      // Assert
      expect(mockOutboxMessageModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.status).toBe('failed');
    });
  });

  describe('getOutboxMessagesForRetry', () => {
    it('should retrieve pending messages for retry', async () => {
      // Arrange
      const mockMessages = [
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg_1',
          status: 'pending'
        }
      ];

      mockOutboxMessageModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockMessages)
          })
        })
      });

      // Act
      const result = await OutboxMessage.getOutboxMessagesForRetry();

      // Assert
      expect(mockOutboxMessageModel.find).toHaveBeenCalledWith({
        status: { $in: ['failed', 'retrying', 'pending'] },
        attempts: { $lt: 3 },
        $or: expect.any(Array)
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('deleteOutboxMessageById', () => {
    it('should delete outbox message', async () => {
      // Arrange
      const messageId = new mongoose.Types.ObjectId();
      const deletedMessage = {
        _id: messageId,
        messageId: 'msg_123'
      };

      mockOutboxMessageModel.findByIdAndDelete.mockResolvedValue(deletedMessage);

      // Act
      const result = await OutboxMessage.deleteOutboxMessageById(messageId);

      // Assert
      expect(mockOutboxMessageModel.findByIdAndDelete).toHaveBeenCalledWith(messageId);
      expect(result).toBeDefined();
    });
  });
});

