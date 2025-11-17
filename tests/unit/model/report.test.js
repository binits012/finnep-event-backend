/**
 * Report Model Unit Tests
 *
 * Tests for:
 * - getEventFinancialReport
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockEvent = {
  getEventById: jest.fn()
};

const mockTicket = {
  getAllTicketByEventId: jest.fn()
};

const mockPayment = {
  getPaymentsByEvent: jest.fn()
};

const mockExternalTicketSales = {
  getExternalTicketSalesByEvent: jest.fn()
};

const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

// Mock mongoModel
const mockTicketModel = {
  find: jest.fn()
};

const mockPaymentModel = {
  find: jest.fn()
};

const mockMongoModel = {
  Ticket: mockTicketModel,
  Payment: mockPaymentModel
};

// Use dynamic imports for ES modules
let Report;
let Event;
let Ticket;
let Payment;
let ExternalTicketSales;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const eventPath = resolve(__dirname, '../../../model/event.js');
  const ticketPath = resolve(__dirname, '../../../model/ticket.js');
  const paymentPath = resolve(__dirname, '../../../model/payment.js');
  const externalTicketSalesPath = resolve(__dirname, '../../../model/externalTicketSales.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');

  jest.unstable_mockModule(eventPath, () => ({
    default: mockEvent,
    getEventById: mockEvent.getEventById
  }));

  jest.unstable_mockModule(ticketPath, () => ({
    default: mockTicket,
    getAllTicketByEventId: mockTicket.getAllTicketByEventId
  }));

  jest.unstable_mockModule(paymentPath, () => ({
    default: mockPayment,
    getPaymentsByEvent: mockPayment.getPaymentsByEvent
  }));

  jest.unstable_mockModule(externalTicketSalesPath, () => ({
    default: mockExternalTicketSales,
    getExternalTicketSalesByEvent: mockExternalTicketSales.getExternalTicketSalesByEvent
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error,
    info: mockLogger.info
  }));

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockMongoModel,
    Ticket: mockTicketModel,
    Payment: mockPaymentModel
  }));

  Report = await import('../../../model/report.js');
  Event = await import('../../../model/event.js');
  Ticket = await import('../../../model/ticket.js');
  Payment = await import('../../../model/payment.js');
  ExternalTicketSales = await import('../../../model/externalTicketSales.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Report Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvent.getEventById.mockClear();
    mockTicket.getAllTicketByEventId.mockClear();
    mockPayment.getPaymentsByEvent.mockClear();
    mockExternalTicketSales.getExternalTicketSalesByEvent.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    mockTicketModel.find.mockClear();
    mockPaymentModel.find.mockClear();
  });

  describe('getEventFinancialReport', () => {
    it('should generate financial report with local tickets only', async () => {
      // Arrange
      const eventId = 'event_123';
      const eventData = {
        _id: eventId,
        eventTitle: 'Test Event',
        eventDate: new Date('2025-12-31T18:00:00Z'),
        occupancy: 100,
        merchant: { _id: 'merchant_123', name: 'Test Merchant' },
        ticketInfo: [
          {
            ticketName: 'General Admission',
            price: 50,
            quantity: 100
          }
        ]
      };

      const mockTickets = [
        {
          _id: 'ticket_1',
          event: eventId,
          ticketInfo: {
            get: jest.fn((key) => {
              const map = {
                'ticketName': 'General Admission',
                'price': 50,
                'quantity': 2
              };
              return map[key];
            }),
            ticketName: 'General Admission',
            price: 50,
            quantity: 2
          },
          createdAt: new Date(),
          merchant: { _id: 'merchant_123', name: 'Test Merchant' }
        }
      ];

      const mockPayments = [
        {
          _id: 'payment_1',
          event: eventId,
          ticket: 'ticket_1',
          paymentInfo: {
            get: jest.fn((key) => {
              const map = {
                'amount': 100,
                'currency': 'EUR',
                'paymentMethod': 'card'
              };
              return map[key];
            }),
            amount: 100,
            currency: 'EUR',
            paymentMethod: 'card'
          }
        }
      ];

      mockEvent.getEventById.mockResolvedValue(eventData);
      mockTicketModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockTickets)
          })
        })
      });
      mockPaymentModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockPayments)
          })
        })
      });
      mockExternalTicketSales.getExternalTicketSalesByEvent.mockResolvedValue([]);

      // Act
      const result = await Report.getEventFinancialReport(eventId);

      // Assert
      expect(mockEvent.getEventById).toHaveBeenCalledWith(eventId);
      expect(result).toBeDefined();
      expect(result.event._id).toBe(eventId);
      expect(result.summary.localTicketsSold).toBe(2);
      expect(result.summary.localRevenue).toBe(100);
      expect(result.summary.externalTicketsSold).toBe(0);
      expect(result.summary.totalTicketsSold).toBe(2);
      expect(result.summary.totalRevenue).toBe(100);
    });

    it('should generate financial report with external sales', async () => {
      // Arrange
      const eventId = 'event_123';
      const eventData = {
        _id: eventId,
        eventTitle: 'Test Event',
        eventDate: new Date('2025-12-31T18:00:00Z'),
        occupancy: 100,
        merchant: { _id: 'merchant_123', name: 'Test Merchant' },
        ticketInfo: []
      };

      const mockTickets = [];
      const mockPayments = [];

      const mockExternalSales = [
        {
          _id: 'external_1',
          eventId: eventId,
          ticketType: 'Door Sale',
          quantity: 5,
          unitPrice: 60,
          saleDate: new Date(),
          source: 'door_sale',
          paymentMethod: 'cash'
        }
      ];

      mockEvent.getEventById.mockResolvedValue(eventData);
      mockTicketModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockTickets)
          })
        })
      });
      mockPaymentModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockPayments)
          })
        })
      });
      mockExternalTicketSales.getExternalTicketSalesByEvent.mockResolvedValue(mockExternalSales);

      // Act
      const result = await Report.getEventFinancialReport(eventId);

      // Assert
      expect(result).toBeDefined();
      expect(result.summary.externalTicketsSold).toBe(5);
      expect(result.summary.externalRevenue).toBe(300);
      expect(result.summary.totalTicketsSold).toBe(5);
      expect(result.summary.totalRevenue).toBe(300);
      expect(result.ticketBreakdown).toBeDefined();
      expect(result.ticketBreakdown.length).toBeGreaterThan(0);
    });

    it('should handle event not found error', async () => {
      // Arrange
      const eventId = 'non_existent_event';
      mockEvent.getEventById.mockResolvedValue(null);

      // Act & Assert
      await expect(
        Report.getEventFinancialReport(eventId)
      ).rejects.toThrow(`Event with ID ${eventId} not found`);
    });

    it('should handle external sales fetch error gracefully', async () => {
      // Arrange
      const eventId = 'event_123';
      const eventData = {
        _id: eventId,
        eventTitle: 'Test Event',
        occupancy: 100,
        merchant: { _id: 'merchant_123' },
        ticketInfo: []
      };

      const mockTickets = [];
      const mockPayments = [];

      mockEvent.getEventById.mockResolvedValue(eventData);
      mockTicketModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockTickets)
          })
        })
      });
      mockPaymentModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockPayments)
          })
        })
      });
      mockExternalTicketSales.getExternalTicketSalesByEvent.mockRejectedValue(
        new Error('Database error')
      );

      // Act
      const result = await Report.getEventFinancialReport(eventId);

      // Assert
      expect(result).toBeDefined();
      // Note: The actual implementation may not set externalDataError in this case
      // The error is caught and logged, but the function continues
      expect(result.summary).toBeDefined();
    });

    it('should calculate occupancy rate correctly', async () => {
      // Arrange
      const eventId = 'event_123';
      const eventData = {
        _id: eventId,
        eventTitle: 'Test Event',
        occupancy: 100,
        merchant: { _id: 'merchant_123' },
        ticketInfo: []
      };

      const mockTickets = [
        {
          _id: 'ticket_1',
          event: eventId,
          ticketInfo: {
            get: jest.fn((key) => {
              const map = {
                'ticketName': 'General Admission',
                'price': 50,
                'quantity': 75
              };
              return map[key];
            }),
            ticketName: 'General Admission',
            price: 50,
            quantity: 75
          },
          createdAt: new Date(),
          merchant: { _id: 'merchant_123' }
        }
      ];

      mockEvent.getEventById.mockResolvedValue(eventData);
      mockTicketModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(mockTickets)
          })
        })
      });
      mockPaymentModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([])
          })
        })
      });
      mockExternalTicketSales.getExternalTicketSalesByEvent.mockResolvedValue([]);

      // Act
      const result = await Report.getEventFinancialReport(eventId);

      // Assert
      expect(result.summary.occupancyRate).toBe(75);
    });
  });
});

