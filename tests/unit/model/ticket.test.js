/**
 * Ticket Model Unit Tests
 *
 * Tests for:
 * - createTicket
 * - getTicketById
 * - updateTicketById
 * - getAllTicketByEventId
 * - getTicketsByEmailCryptoId
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockTicketModel = jest.fn();
mockTicketModel.find = jest.fn();
mockTicketModel.findById = jest.fn();
mockTicketModel.findOne = jest.fn();
mockTicketModel.findOneAndUpdate = jest.fn();

const mockModel = {
  Ticket: mockTicketModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Ticket;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Ticket: mockTicketModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Ticket = await import('../../../model/ticket.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Ticket Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicketModel.mockClear();
    mockTicketModel.find.mockClear();
    mockTicketModel.findById.mockClear();
    mockTicketModel.findOne.mockClear();
    mockTicketModel.findOneAndUpdate.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createTicket', () => {
    it('should create a new ticket', async () => {
      // Arrange
      const ticketData = {
        qrCode: 'data:image/png;base64,...',
        ticketFor: new mongoose.Types.ObjectId(),
        event: new mongoose.Types.ObjectId(),
        type: 'paid',
        ticketInfo: new Map([
          ['ticketName', 'General Admission'],
          ['price', 50],
          ['quantity', 2]
        ]),
        otp: 'ABC123',
        merchantId: new mongoose.Types.ObjectId(),
        externalMerchantId: 'merchant_123'
      };

      const savedTicketData = {
        _id: new mongoose.Types.ObjectId(),
        ...ticketData
      };

      const mockSavedTicket = {
        _id: savedTicketData._id,
        ...ticketData,
        save: jest.fn().mockResolvedValue(savedTicketData)
      };

      mockTicketModel.mockImplementation(() => mockSavedTicket);

      // Act
      const result = await Ticket.createTicket(
        ticketData.qrCode,
        ticketData.ticketFor,
        ticketData.event,
        ticketData.type,
        ticketData.ticketInfo,
        ticketData.otp,
        ticketData.merchantId,
        ticketData.externalMerchantId
      );

      // Assert
      expect(mockTicketModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidTicketData = {
        // Missing required fields
        qrCode: null,
        ticketFor: null
      };

      const mockError = new Error('Validation failed');
      const mockTicketInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockTicketModel.mockImplementation(() => mockTicketInstance);

      // Act & Assert
      await expect(
        Ticket.createTicket(
          invalidTicketData.qrCode,
          invalidTicketData.ticketFor,
          null,
          null,
          null,
          null,
          null,
          null
        )
      ).rejects.toThrow();
    });
  });

  describe('getTicketById', () => {
    it('should retrieve a ticket by ID with population', async () => {
      // Arrange
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicket = {
        _id: ticketId,
        otp: 'ABC123',
        ticketFor: {
          _id: new mongoose.Types.ObjectId(),
          email: 'user@example.com'
        },
        event: {
          _id: new mongoose.Types.ObjectId(),
          eventTitle: 'Test Event'
        }
      };

      mockTicketModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockTicket)
            })
          })
        })
      });

      // Act
      const result = await Ticket.getTicketById(ticketId, true);

      // Assert
      expect(mockTicketModel.findById).toHaveBeenCalledWith(ticketId);
      expect(result).toBeDefined();
      expect(result._id).toEqual(ticketId);
    });

    it('should retrieve a ticket by ID without populating ticketFor', async () => {
      // Arrange
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicket = {
        _id: ticketId,
        otp: 'ABC123',
        ticketFor: new mongoose.Types.ObjectId(),
        event: {
          _id: new mongoose.Types.ObjectId(),
          eventTitle: 'Test Event'
        }
      };

      mockTicketModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockTicket)
          })
        })
      });

      // Act
      const result = await Ticket.getTicketById(ticketId, false);

      // Assert
      expect(result).toBeDefined();
      expect(result.ticketFor).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    it('should return null for non-existent ticket', async () => {
      // Arrange
      const nonExistentId = new mongoose.Types.ObjectId();

      mockTicketModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null)
          })
        })
      });

      // Act
      const result = await Ticket.getTicketById(nonExistentId, false);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateTicketById', () => {
    it('should update a ticket successfully', async () => {
      // Arrange
      const ticketId = new mongoose.Types.ObjectId();
      const updateData = {
        qrCode: 'data:image/png;base64,updated...',
        ics: 'BEGIN:VCALENDAR...'
      };

      const updatedTicket = {
        _id: ticketId,
        ...updateData
      };

      mockTicketModel.findOneAndUpdate.mockResolvedValue(updatedTicket);

      // Act
      const result = await Ticket.updateTicketById(ticketId, updateData);

      // Assert
      expect(mockTicketModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ticketId },
        { $set: updateData },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.qrCode).toBe(updateData.qrCode);
    });
  });

  describe('getAllTicketByEventId', () => {
    it('should retrieve all tickets for an event', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();
      const mockTickets = [
        {
          _id: new mongoose.Types.ObjectId(),
          event: eventId,
          otp: 'ABC123'
        },
        {
          _id: new mongoose.Types.ObjectId(),
          event: eventId,
          otp: 'DEF456'
        }
      ];

      mockTicketModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(mockTickets)
            })
          })
        })
      });

      // Act
      const result = await Ticket.getAllTicketByEventId(eventId);

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getTicketsByEmailCryptoId', () => {
    it('should retrieve tickets by email crypto ID', async () => {
      // Arrange
      const emailCryptoId = new mongoose.Types.ObjectId();
      const mockTickets = [
        {
          _id: new mongoose.Types.ObjectId(),
          ticketFor: emailCryptoId,
          otp: 'ABC123'
        }
      ];

      mockTicketModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockTickets)
        })
      });

      // Act
      const result = await Ticket.getTicketsByEmailCryptoId(emailCryptoId);

      // Assert
      expect(mockTicketModel.find).toHaveBeenCalledWith({ ticketFor: emailCryptoId });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

