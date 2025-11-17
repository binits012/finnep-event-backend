/**
 * Event Model Unit Tests
 *
 * Tests for:
 * - createEvent
 * - getEventById
 * - updateEventById
 * - getEvents
 * - deleteEventById
 */

import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockEventModel = jest.fn();
mockEventModel.find = jest.fn();
mockEventModel.findById = jest.fn();
mockEventModel.findOne = jest.fn();
mockEventModel.findOneAndUpdate = jest.fn();
mockEventModel.findOneAndDelete = jest.fn();
mockEventModel.findByIdAndUpdate = jest.fn();
mockEventModel.findByIdAndDelete = jest.fn();
mockEventModel.countDocuments = jest.fn();

const mockTicketModel = jest.fn();
const mockModel = {
  Event: mockEventModel,
  Ticket: mockTicketModel
};

// Use dynamic imports for ES modules
let Event;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Event: mockEventModel,
    Ticket: mockTicketModel
  }));

  Event = await import('../../../model/event.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Event Model', () => {
  let testEventId;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventModel.mockClear();
    mockEventModel.find.mockClear();
    mockEventModel.findById.mockClear();
    mockEventModel.findOne.mockClear();
    mockEventModel.findOneAndUpdate.mockClear();
    mockEventModel.findOneAndDelete.mockClear();
    mockEventModel.findByIdAndUpdate.mockClear();
    mockEventModel.findByIdAndDelete.mockClear();
    mockEventModel.countDocuments.mockClear();
  });

  describe('createEvent', () => {
    it('should create a new event', async () => {
      // Arrange
      const eventData = {
        eventTitle: 'Test Event',
        eventDescription: 'Test Description',
        eventDate: new Date('2025-12-31T18:00:00Z'),
        occupancy: 100,
        ticketInfo: [
          {
            ticketName: 'General Admission',
            price: 50,
            quantity: 100
          }
        ],
        active: true,
        status: 'up-coming',
        merchant: new mongoose.Types.ObjectId()
      };

      const savedEventData = {
        _id: new mongoose.Types.ObjectId(),
        ...eventData
      };

      const mockSavedEvent = {
        _id: savedEventData._id,
        ...eventData,
        save: jest.fn().mockResolvedValue(savedEventData)
      };

      mockEventModel.mockImplementation(() => mockSavedEvent);

      // Act
      const result = await Event.createEvent(
        eventData.eventTitle,
        eventData.eventDescription,
        eventData.eventDate,
        eventData.occupancy,
        eventData.ticketInfo,
        null, // eventPromotionPhoto
        null, // eventPhoto
        null, // eventLocationAddress
        null, // eventLocationGeoCode
        null, // transportLink
        null, // socialMedia
        'en', // lang
        0, // position
        eventData.active,
        null, // eventName
        null, // videoUrl
        {}, // otherInfo
        null, // eventTimezone
        null, // city
        null, // country
        null, // venueInfo
        null, // externalMerchantId
        eventData.merchant,
        null, // externalEventId
        null // venue
      );

      // Assert
      expect(mockEventModel).toHaveBeenCalled();
      expect(result).toBeDefined();
      testEventId = result._id;
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidEventData = {
        // Missing required fields
        eventTitle: '',
        occupancy: -1
      };

      const mockError = new Error('Validation failed');
      const mockEventInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockEventModel.mockImplementation(() => mockEventInstance);

      // Act & Assert
      await expect(
        Event.createEvent(
          invalidEventData.eventTitle,
          null,
          null,
          invalidEventData.occupancy,
          [],
          null, null, null, null, null, null, 'en', 0, true, null, null, {}, null, null, null, null, null, null, null, null
        )
      ).rejects.toThrow();
    });
  });

  describe('getEventById', () => {
    it('should retrieve an event by ID', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();
      const mockEvent = {
        _id: eventId,
        eventTitle: 'Test Event',
        active: true
      };

      mockEventModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockEvent)
        })
      });

      // Act
      const result = await Event.getEventById(eventId);

      // Assert
      expect(mockEventModel.findById).toHaveBeenCalledWith({ _id: eventId });
      expect(result).toBeDefined();
      expect(result._id).toEqual(eventId);
    });

    it('should return null for non-existent event', async () => {
      // Arrange
      const nonExistentId = new mongoose.Types.ObjectId();

      mockEventModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null)
        })
      });

      // Act
      const result = await Event.getEventById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateEventById', () => {
    it('should update an event successfully', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();
      const updateData = {
        eventTitle: 'Updated Event Title',
        active: false
      };

      const updatedEvent = {
        _id: eventId,
        ...updateData
      };

      mockEventModel.findByIdAndUpdate = jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedEvent)
        })
      });

      // Act
      const result = await Event.updateEventById(eventId, updateData);

      // Assert
      expect(mockEventModel.findByIdAndUpdate).toHaveBeenCalledWith(
        eventId,
        { $set: updateData },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.eventTitle).toBe(updateData.eventTitle);
    });
  });

  describe('getEvents', () => {
    it('should retrieve events with filters', async () => {
      // Arrange
      const filters = {
        active: true,
        status: 'up-coming'
      };

      const mockEvents = [
        {
          _id: new mongoose.Types.ObjectId(),
          eventTitle: 'Event 1',
          active: true,
          status: 'up-coming'
        },
        {
          _id: new mongoose.Types.ObjectId(),
          eventTitle: 'Event 2',
          active: true,
          status: 'up-coming'
        }
      ];

      mockEventModel.countDocuments = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(2)
      });

      mockEventModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockEvents.map(e => ({ ...e, toObject: () => e })))
              })
            })
          })
        })
      });

      // Act
      const result = await Event.getEvents(1, 10, filters);

      // Assert
      expect(result).toBeDefined();
      expect(result.events).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.pagination).toBeDefined();
    });
  });

  describe('deleteEventById', () => {
    it('should delete an event successfully', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();
      const deletedEvent = {
        _id: eventId,
        eventTitle: 'Deleted Event'
      };

      mockEventModel.findOneAndDelete = jest.fn().mockResolvedValue(deletedEvent);

      // Act
      const result = await Event.deleteEventById(eventId);

      // Assert
      expect(mockEventModel.findOneAndDelete).toHaveBeenCalledWith({ _id: eventId, active: false });
      expect(result).toBeDefined();
      expect(result._id).toEqual(eventId);
    });
  });
});

