/**
 * Order Ticket Model Unit Tests
 *
 * Tests for:
 * - createOrderTicket
 * - getOrderTicketById
 * - updateOrderTicketById
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockOrderTicketModel = jest.fn();
mockOrderTicketModel.find = jest.fn();
mockOrderTicketModel.findById = jest.fn();
mockOrderTicketModel.findOneAndUpdate = jest.fn();
mockOrderTicketModel.findByIdAndUpdate = jest.fn();

const mockModel = {
  OrderTicket: mockOrderTicketModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let OrderTicket;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    OrderTicket: mockOrderTicketModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  OrderTicket = await import('../../../model/orderTicket.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Order Ticket Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderTicketModel.mockClear();
    mockOrderTicketModel.find.mockClear();
    mockOrderTicketModel.findById.mockClear();
    mockOrderTicketModel.findOneAndUpdate.mockClear();
    mockOrderTicketModel.findByIdAndUpdate.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createOrderTicket', () => {
    it('should create a new order ticket', async () => {
      // Arrange
      const otp = 'ABC123';
      const ticketInfo = new Map([
        ['email', 'user@example.com'],
        ['eventId', new mongoose.Types.ObjectId().toString()],
        ['ticketType', 'general'],
        ['quantity', 2],
        ['price', 50]
      ]);

      const savedOrderTicketData = {
        _id: new mongoose.Types.ObjectId(),
        otp: otp,
        ticketInfo: ticketInfo,
        status: 'pending'
      };

      const mockSavedOrderTicket = {
        _id: savedOrderTicketData._id,
        otp: otp,
        ticketInfo: ticketInfo,
        status: 'pending',
        save: jest.fn().mockResolvedValue(savedOrderTicketData)
      };

      mockOrderTicketModel.mockImplementation(() => mockSavedOrderTicket);

      // Act
      const result = await OrderTicket.createOrderTicket(otp, ticketInfo);

      // Assert
      expect(mockOrderTicketModel).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.otp).toBe(otp);
    });

    it('should handle validation errors', async () => {
      // Arrange
      const otp = null;
      const ticketInfo = new Map();

      const mockError = new Error('Validation failed');
      const mockOrderTicketInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockOrderTicketModel.mockImplementation(() => mockOrderTicketInstance);

      // Act & Assert
      await expect(
        OrderTicket.createOrderTicket(otp, ticketInfo)
      ).rejects.toThrow();
    });
  });

  describe('getOrderTicketById', () => {
    it('should retrieve order ticket by ID', async () => {
      // Arrange
      const orderTicketId = new mongoose.Types.ObjectId();
      const mockOrderTicket = {
        _id: orderTicketId,
        otp: 'ABC123',
        ticketInfo: new Map([['email', 'user@example.com']]),
        status: 'pending'
      };

      mockOrderTicketModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockOrderTicket)
      });

      // Act
      const result = await OrderTicket.getOrderTicketById(orderTicketId);

      // Assert
      expect(mockOrderTicketModel.findById).toHaveBeenCalledWith({ _id: orderTicketId });
      expect(result).toBeDefined();
      expect(result._id).toEqual(orderTicketId);
    });

    it('should return null for non-existent order ticket', async () => {
      // Arrange
      const nonExistentId = new mongoose.Types.ObjectId();

      mockOrderTicketModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null)
      });

      // Act
      const result = await OrderTicket.getOrderTicketById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateOrderTicketById', () => {
    it('should update order ticket successfully', async () => {
      // Arrange
      const orderTicketId = new mongoose.Types.ObjectId();
      const updateData = {
        status: 'completed',
        attempts: 1
      };

      const updatedOrderTicket = {
        _id: orderTicketId,
        otp: 'ABC123',
        status: 'completed',
        attempts: 1
      };

      mockOrderTicketModel.findByIdAndUpdate = jest.fn().mockResolvedValue(updatedOrderTicket);

      // Act
      const result = await OrderTicket.updateOrderTicketById(orderTicketId, updateData);

      // Assert
      expect(mockOrderTicketModel.findByIdAndUpdate).toHaveBeenCalledWith(
        orderTicketId,
        { $set: updateData },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.status).toBe('completed');
    });

    it('should handle update errors', async () => {
      // Arrange
      const orderTicketId = new mongoose.Types.ObjectId();
      const updateData = {
        status: 'completed'
      };

      const mockError = new Error('Update failed');
      mockOrderTicketModel.findByIdAndUpdate.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        OrderTicket.updateOrderTicketById(orderTicketId, updateData)
      ).rejects.toThrow();
    });
  });
});

