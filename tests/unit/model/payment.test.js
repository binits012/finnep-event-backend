/**
 * Payment Model Unit Tests
 *
 * Tests for:
 * - createPayment
 * - getPayments
 * - getPaymentsByEvent
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockPaymentModel = jest.fn();
mockPaymentModel.find = jest.fn();
mockPaymentModel.findById = jest.fn();

const mockModel = {
  Payment: mockPaymentModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Payment;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Payment: mockPaymentModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Payment = await import('../../../model/payment.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Payment Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentModel.mockClear();
    mockPaymentModel.find.mockClear();
    mockPaymentModel.findById.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createPayment', () => {
    it('should create a new payment', async () => {
      // Arrange
      const paymentInfo = new Map([
        ['amount', 5000],
        ['currency', 'EUR'],
        ['paymentMethod', 'card']
      ]);
      const eventId = new mongoose.Types.ObjectId();
      const ticketId = new mongoose.Types.ObjectId();

      const savedPaymentData = {
        _id: new mongoose.Types.ObjectId(),
        paymentInfo: paymentInfo,
        event: eventId,
        ticket: ticketId
      };

      const mockSavedPayment = {
        _id: savedPaymentData._id,
        paymentInfo: paymentInfo,
        event: eventId,
        ticket: ticketId,
        save: jest.fn().mockResolvedValue(savedPaymentData)
      };

      mockPaymentModel.mockImplementation(() => mockSavedPayment);

      // Act
      const result = await Payment.createPayment(paymentInfo, eventId, ticketId);

      // Assert
      expect(mockPaymentModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const paymentInfo = new Map();
      const eventId = new mongoose.Types.ObjectId();
      const ticketId = new mongoose.Types.ObjectId();

      const mockError = new Error('Validation failed');
      const mockPaymentInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockPaymentModel.mockImplementation(() => mockPaymentInstance);

      // Act & Assert
      await expect(
        Payment.createPayment(paymentInfo, eventId, ticketId)
      ).rejects.toThrow();
    });
  });

  describe('getPayments', () => {
    it('should retrieve all payments', async () => {
      // Arrange
      const mockPayments = [
        {
          _id: new mongoose.Types.ObjectId(),
          paymentInfo: new Map([['amount', 5000]]),
          event: new mongoose.Types.ObjectId()
        },
        {
          _id: new mongoose.Types.ObjectId(),
          paymentInfo: new Map([['amount', 3000]]),
          event: new mongoose.Types.ObjectId()
        }
      ];

      mockPaymentModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockPayments)
      });

      // Act
      const result = await Payment.getPayments();

      // Assert
      expect(mockPaymentModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('getPaymentsByEvent', () => {
    it('should retrieve payments for a specific event', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();
      const mockPayments = [
        {
          _id: new mongoose.Types.ObjectId(),
          paymentInfo: new Map([['amount', 5000]]),
          event: eventId
        }
      ];

      mockPaymentModel.find.mockResolvedValue(mockPayments);

      // Act
      const result = await Payment.getPaymentsByEvent(eventId);

      // Assert
      expect(mockPaymentModel.find).toHaveBeenCalledWith({ event: eventId });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array for event with no payments', async () => {
      // Arrange
      const eventId = new mongoose.Types.ObjectId();

      mockPaymentModel.find.mockResolvedValue([]);

      // Act
      const result = await Payment.getPaymentsByEvent(eventId);

      // Assert
      expect(result).toEqual([]);
    });
  });
});

