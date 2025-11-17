/**
 * Event Handler Unit Tests
 *
 * Tests for:
 * - handleEventMessage
 * - handleEventCreated
 * - handleEventUpdated
 * - handleEventDeleted
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockEvent = {
  createEvent: jest.fn(),
  getEventByMerchantAndExternalId: jest.fn(),
  updateEventById: jest.fn(),
  deleteEventById: jest.fn()
};

const mockInbox = {
  saveMessage: jest.fn(),
  isProcessed: jest.fn(),
  markProcessed: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

const mockMerchant = {
  getMerchantByMerchantId: jest.fn()
};

// Use dynamic imports for ES modules
let eventHandler;
let Event;
let inboxModel;
let logger;
let Merchant;

beforeAll(async () => {
  // Use absolute paths for mocking
  const eventPath = resolve(__dirname, '../../../../model/event.js');
  const inboxMessagePath = resolve(__dirname, '../../../../model/inboxMessage.js');
  const loggerPath = resolve(__dirname, '../../../../model/logger.js');
  const merchantPath = resolve(__dirname, '../../../../model/merchant.js');

  jest.unstable_mockModule(eventPath, () => ({
    default: mockEvent,
    createEvent: mockEvent.createEvent,
    getEventByMerchantAndExternalId: mockEvent.getEventByMerchantAndExternalId,
    updateEventById: mockEvent.updateEventById,
    deleteEventById: mockEvent.deleteEventById
  }));

  jest.unstable_mockModule(inboxMessagePath, () => ({
    inboxModel: mockInbox
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    info: mockLogger.info,
    error: mockLogger.error,
    warn: mockLogger.warn
  }));

  jest.unstable_mockModule(merchantPath, () => ({
    getMerchantByMerchantId: mockMerchant.getMerchantByMerchantId
  }));

  eventHandler = await import('../../../../rabbitMQ/handlers/eventHandler.js');
  Event = await import('../../../../model/event.js');
  inboxModel = (await import('../../../../model/inboxMessage.js')).inboxModel;
  logger = await import('../../../../model/logger.js');
  Merchant = await import('../../../../model/merchant.js');
});

describe('Event Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvent.createEvent.mockClear();
    mockEvent.getEventByMerchantAndExternalId.mockClear();
    mockEvent.updateEventById.mockClear();
    mockEvent.deleteEventById.mockClear();
    mockInbox.saveMessage.mockClear();
    mockInbox.isProcessed.mockClear();
    mockInbox.markProcessed.mockClear();
    mockMerchant.getMerchantByMerchantId.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  describe('handleEventMessage', () => {
    it('should handle event.created message', async () => {
      // Arrange
      const message = {
        routingKey: 'event.created',
        id: 'ext_event_123',
        merchantId: 'merchant_123',
        title: 'Test Event',
        metaData: {
          causationId: 'msg_123'
        }
      };

      const mockMerchantData = {
        _id: '507f1f77bcf86cd799439012',
        merchantId: 'merchant_123'
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(mockMerchantData);
      mockEvent.createEvent.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        eventTitle: 'Test Event'
      });
      mockInbox.markProcessed.mockResolvedValue(true);

      // Act
      await eventHandler.handleEventMessage(message);

      // Assert
      expect(mockInbox.isProcessed).toHaveBeenCalledWith('msg_123');
      expect(mockMerchant.getMerchantByMerchantId).toHaveBeenCalledWith('merchant_123');
      expect(mockEvent.createEvent).toHaveBeenCalled();
    });

    it('should handle event.updated message', async () => {
      // Arrange
      const message = {
        routingKey: 'event.updated',
        id: 'ext_event_123',
        merchantId: 'merchant_123',
        title: 'Updated Event Title',
        metaData: {
          causationId: 'msg_456'
        }
      };

      const existingEvent = {
        _id: '507f1f77bcf86cd799439011',
        externalEventId: 'ext_event_123'
      };

      const mockMerchantData = {
        _id: '507f1f77bcf86cd799439012',
        merchantId: 'merchant_123'
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(mockMerchantData);
      mockEvent.getEventByMerchantAndExternalId.mockResolvedValue(existingEvent);
      mockEvent.updateEventById.mockResolvedValue({
        ...existingEvent,
        eventTitle: 'Updated Event Title'
      });
      mockInbox.markProcessed.mockResolvedValue(true);

      // Act
      await eventHandler.handleEventMessage(message);

      // Assert
      expect(mockMerchant.getMerchantByMerchantId).toHaveBeenCalledWith('merchant_123');
      expect(mockEvent.getEventByMerchantAndExternalId).toHaveBeenCalledWith('merchant_123', 'ext_event_123');
      expect(mockEvent.updateEventById).toHaveBeenCalled();
    });

    it('should handle event.deleted message', async () => {
      // Arrange
      const message = {
        routingKey: 'event.deleted',
        id: 'ext_event_123',
        merchantId: 'merchant_123',
        metaData: {
          causationId: 'msg_789'
        }
      };

      const existingEvent = {
        _id: '507f1f77bcf86cd799439011',
        externalEventId: 'ext_event_123'
      };

      const mockMerchantData = {
        _id: '507f1f77bcf86cd799439012',
        merchantId: 'merchant_123'
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(mockMerchantData);
      mockEvent.getEventByMerchantAndExternalId.mockResolvedValue(existingEvent);
      mockEvent.deleteEventById.mockResolvedValue(existingEvent);
      mockInbox.markProcessed.mockResolvedValue(true);

      // Act
      await eventHandler.handleEventMessage(message);

      // Assert
      expect(mockMerchant.getMerchantByMerchantId).toHaveBeenCalledWith('merchant_123');
      expect(mockEvent.getEventByMerchantAndExternalId).toHaveBeenCalledWith('merchant_123', 'ext_event_123');
      expect(mockEvent.deleteEventById).toHaveBeenCalledWith(existingEvent._id);
    });

    it('should skip already processed messages', async () => {
      // Arrange
      const message = {
        routingKey: 'event.created',
        eventId: 'event_123',
        metaData: {
          causationId: 'msg_123'
        }
      };

      mockInbox.isProcessed.mockResolvedValue(true);

      // Act
      await eventHandler.handleEventMessage(message);

      // Assert
      expect(mockEvent.createEvent).not.toHaveBeenCalled();
    });

    it('should handle upsert behavior for event.updated', async () => {
      // Arrange
      const message = {
        routingKey: 'event.updated',
        id: 'ext_event_123',
        merchantId: 'merchant_123',
        title: 'New Event',
        description: 'Description',
        event_date: new Date(),
        occupancy: 100,
        metaData: {
          causationId: 'msg_456'
        }
      };

      const mockMerchantData = {
        _id: '507f1f77bcf86cd799439012',
        merchantId: 'merchant_123'
      };

      // Event doesn't exist yet
      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(mockMerchantData);
      mockEvent.getEventByMerchantAndExternalId.mockResolvedValue(null);
      mockEvent.createEvent.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        eventTitle: 'New Event'
      });
      mockInbox.markProcessed.mockResolvedValue(true);

      // Act
      await eventHandler.handleEventMessage(message);

      // Assert
      // Should create event if it doesn't exist (upsert behavior)
      expect(mockMerchant.getMerchantByMerchantId).toHaveBeenCalledWith('merchant_123');
      expect(mockEvent.getEventByMerchantAndExternalId).toHaveBeenCalledWith('merchant_123', 'ext_event_123');
      expect(mockEvent.createEvent).toHaveBeenCalled();
    });
  });
});

