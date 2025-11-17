/**
 * Payment Actions Unit Tests
 *
 * Tests for:
 * - checkoutSuccess
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockPayment = {
  createPayment: jest.fn()
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let paymentActions;

beforeAll(async () => {
  // Use absolute paths for mocking
  const paymentPath = resolve(__dirname, '../../../model/payment.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(paymentPath, () => ({
    default: mockPayment,
    createPayment: mockPayment.createPayment
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  paymentActions = await import('../../../util/paymentActions.js');
});

describe('Payment Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPayment.createPayment.mockClear();
    mockLogger.error.mockClear();
  });

  describe('checkoutSuccess', () => {
    it('should create payment successfully', async () => {
      // Arrange
      const mockEvent = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_status: 'paid',
            amount_total: 5000
          }
        }
      };

      const metadata = {
        ticketOrderId: 'order_123',
        eventId: 'event_123'
      };

      mockPayment.createPayment.mockResolvedValue({
        _id: 'payment_123',
        eventId: metadata.eventId,
        ticketOrderId: metadata.ticketOrderId
      });

      // Act
      await paymentActions.checkoutSuccess(mockEvent, metadata);

      // Assert
      expect(mockPayment.createPayment).toHaveBeenCalledWith(
        { payment: mockEvent },
        metadata.eventId,
        metadata.ticketOrderId
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle errors and throw', async () => {
      // Arrange
      const mockEvent = {
        id: 'evt_test_123',
        type: 'checkout.session.completed'
      };

      const metadata = {
        ticketOrderId: 'order_123',
        eventId: 'event_123'
      };

      const mockError = new Error('Database error');
      mockPayment.createPayment.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        paymentActions.checkoutSuccess(mockEvent, metadata)
      ).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalledWith(mockError);
    });

    it('should handle missing metadata', async () => {
      // Arrange
      const mockEvent = {
        id: 'evt_test_123'
      };

      const metadata = {
        // Missing ticketOrderId and eventId
      };

      mockPayment.createPayment.mockResolvedValue({});

      // Act
      await paymentActions.checkoutSuccess(mockEvent, metadata);

      // Assert
      expect(mockPayment.createPayment).toHaveBeenCalledWith(
        { payment: mockEvent },
        undefined,
        undefined
      );
    });
  });
});

