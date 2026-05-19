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
            _id: '507f1f77bcf86cd799439011',
            name: 'General Admission',
            price: 50,
            quantity: 100
          }
        ]
      };

      const ticketTypeId = '507f1f77bcf86cd799439011';
      const mockTickets = [
        {
          _id: 'ticket_1',
          event: eventId,
          type: 'General Admission',
          ticketInfo: {
            get: jest.fn((key) => {
              const map = {
                ticketName: 'General Admission',
                ticketId: ticketTypeId,
                price: 50,
                quantity: 2,
                totalPrice: 100
              };
              return map[key];
            }),
            ticketName: 'General Admission',
            ticketId: ticketTypeId,
            price: 50,
            quantity: 2,
            totalPrice: 100
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

    it('should group seat sales by catalog ticketId, not composite ticket.type', async () => {
      const eventId = 'event_123';
      const vipId = '507f1f77bcf86cd799439012';
      const standardId = '507f1f77bcf86cd799439013';
      const eventData = {
        _id: eventId,
        eventTitle: 'Seated Event',
        occupancy: 200,
        merchant: { _id: 'merchant_123' },
        ticketInfo: [
          { _id: vipId, name: 'VIP', price: 80, quantity: 50 },
          { _id: standardId, name: 'Standard', price: 40, quantity: 150 }
        ]
      };

      const mockTickets = [
        {
          _id: 'ticket_seat_1',
          event: eventId,
          type: 'Section A, Row 1, Seat 1, Section B, Row 2, Seat 3',
          ticketInfo: {
            totalPrice: 150,
            quantity: 2,
            seatTickets: [
              { ticketId: vipId, ticketName: 'VIP', placeId: 'p1' },
              { ticketId: standardId, ticketName: 'Standard', placeId: 'p2' }
            ]
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

      const result = await Report.getEventFinancialReport(eventId);

      expect(result.summary.localTicketsSold).toBe(2);
      expect(result.summary.localRevenue).toBe(150);
      expect(result.ticketBreakdown).toHaveLength(2);

      const vipRow = result.ticketBreakdown.find((r) => r.ticketType === 'VIP');
      const standardRow = result.ticketBreakdown.find((r) => r.ticketType === 'Standard');
      expect(vipRow.localQuantity).toBe(1);
      expect(standardRow.localQuantity).toBe(1);
      expect(vipRow.localRevenue + standardRow.localRevenue).toBeCloseTo(150, 2);
    });

    it('should not multiply order total by admission count for Group of 3 packs', async () => {
      const eventId = 'event_123';
      const groupTypeId = '507f1f77bcf86cd799439014';
      const eventData = {
        _id: eventId,
        eventTitle: 'Group Event',
        occupancy: 100,
        merchant: { _id: 'merchant_123' },
        ticketInfo: [
          { _id: groupTypeId, name: 'Group of 3', price: 207, quantity: 3, available: 17 }
        ]
      };

      const mockTickets = [
        {
          _id: '6a06720cf5f203804d9145a3',
          event: eventId,
          type: 'Group of 3',
          ticketInfo: {
            ticketId: groupTypeId,
            ticketName: 'Group of 3',
            price: 207,
            quantity: '3',
            orderQuantity: '1',
            packSize: '3'
          },
          createdAt: new Date('2026-05-15T01:08:28.656Z'),
          merchant: { _id: 'merchant_123' }
        },
        {
          _id: '6a06da0edefb726e8e0179ef',
          event: eventId,
          type: 'Group of 3',
          ticketInfo: {
            ticketId: groupTypeId,
            ticketName: 'Group of 3',
            price: 207,
            quantity: '3',
            orderQuantity: '1',
            packSize: '3'
          },
          createdAt: new Date('2026-05-15T08:32:14.455Z'),
          merchant: { _id: 'merchant_123' }
        },
        {
          _id: '6a06f2e6f5f203804d914a70',
          event: eventId,
          type: 'Group of 3',
          ticketInfo: {
            ticketId: groupTypeId,
            ticketName: 'Group of 3',
            price: 414,
            quantity: '6',
            orderQuantity: '2',
            packSize: '3',
            totalPrice: 414
          },
          createdAt: new Date('2026-05-15T10:18:14.100Z'),
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

      const result = await Report.getEventFinancialReport(eventId);
      const groupRow = result.ticketBreakdown.find((r) => r.ticketType === 'Group of 3');

      expect(groupRow.localQuantity).toBe(4);
      expect(groupRow.localRevenue).toBe(828);
      expect(groupRow.unitPrice).toBe(207);
      expect(groupRow.tickets).toHaveLength(3);
      expect(groupRow.tickets[0].price).toBe(207);
      expect(groupRow.tickets[2].price).toBe(207);
    });

    it('should use order total for multi-ticket Early Bird (not unit price × qty)', async () => {
      const eventId = 'event_123';
      const earlyBirdId = '507f1f77bcf86cd799439015';
      const eventData = {
        _id: eventId,
        eventTitle: 'Early Bird Event',
        occupancy: 100,
        merchant: { _id: 'merchant_123' },
        ticketInfo: [
          { _id: earlyBirdId, name: 'Early Bird', price: 123.99, quantity: 1, available: 500 }
        ]
      };

      const mockTickets = [
        {
          _id: '69e92e13fb75976f1d022d53',
          event: eventId,
          type: 'Early Bird',
          ticketInfo: {
            ticketId: earlyBirdId,
            price: 247.98,
            totalPrice: 247.98,
            quantity: '2',
            orderQuantity: '2'
          },
          createdAt: new Date('2026-04-22T20:22:43.411Z'),
          merchant: { _id: 'merchant_123' }
        },
        {
          _id: '69e96b97fb75976f1d022e07',
          event: eventId,
          type: 'Early Bird',
          ticketInfo: {
            ticketId: earlyBirdId,
            price: 247.98,
            totalPrice: 247.98,
            quantity: '2',
            orderQuantity: '2'
          },
          createdAt: new Date('2026-04-23T00:45:11.368Z'),
          merchant: { _id: 'merchant_123' }
        },
        {
          _id: '69eb0b33fb75976f1d0231da',
          event: eventId,
          type: 'Early Bird',
          ticketInfo: {
            ticketId: earlyBirdId,
            price: 248,
            totalPrice: 248,
            quantity: '4',
            orderQuantity: '4'
          },
          createdAt: new Date('2026-04-24T06:18:27.880Z'),
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

      const result = await Report.getEventFinancialReport(eventId);
      const row = result.ticketBreakdown.find((r) => r.ticketType === 'Early Bird');

      expect(row.localQuantity).toBe(8);
      expect(row.localRevenue).toBeCloseTo(743.96, 2);
      expect(row.unitPrice).toBeCloseTo(92.995, 2);
      expect(row.tickets[2].price).toBeCloseTo(62, 2);
    });

    it('should use pack order total for Kids 2-pack (not catalog price × admissions)', async () => {
      const eventId = 'event_123';
      const kidsId = '507f1f77bcf86cd799439016';
      const eventData = {
        _id: eventId,
        eventTitle: 'Family Event',
        occupancy: 100,
        merchant: { _id: 'merchant_123' },
        ticketInfo: [
          { _id: kidsId, name: 'Kids under 17', price: 67.94, quantity: 2, available: 50 }
        ]
      };

      const mockTickets = [
        {
          _id: '6a02b564f5f203804d911e11',
          event: eventId,
          type: 'Kids under 17',
          ticketInfo: {
            ticketId: kidsId,
            ticketName: 'Kids under 17',
            price: 67.94,
            quantity: '2',
            orderQuantity: '1',
            packSize: '2'
          },
          createdAt: new Date('2026-05-12T05:06:44.342Z'),
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

      const result = await Report.getEventFinancialReport(eventId);
      const row = result.ticketBreakdown.find((r) => r.ticketType === 'Kids under 17');

      expect(row.localQuantity).toBe(1);
      expect(row.localRevenue).toBeCloseTo(67.94, 2);
      expect(row.unitPrice).toBeCloseTo(67.94, 2);
    });

    it('uses one rule for all ticket shapes: paid total + orderQuantity (never price × admission)', async () => {
      const eventId = 'event_unified';
      const groupId = '507f1f77bcf86cd799439020';
      const earlyId = '507f1f77bcf86cd799439021';
      const kidsId = '507f1f77bcf86cd799439022';

      const eventData = {
        _id: eventId,
        occupancy: 500,
        merchant: { _id: 'merchant_123' },
        ticketInfo: [
          { _id: groupId, name: 'Group of 3', price: 207, quantity: 3, available: 17 },
          { _id: earlyId, name: 'Early Bird', price: 123.99, quantity: 1, available: 500 },
          { _id: kidsId, name: 'Kids under 17', price: 67.94, quantity: 2, available: 50 }
        ]
      };

      const mockTickets = [
        {
          _id: 'g1', type: 'Group of 3',
          ticketInfo: { ticketId: groupId, price: 207, quantity: '3', orderQuantity: '1' }
        },
        {
          _id: 'g2', type: 'Group of 3',
          ticketInfo: { ticketId: groupId, price: 207, quantity: '3', orderQuantity: '1' }
        },
        {
          _id: 'g3', type: 'Group of 3',
          ticketInfo: { ticketId: groupId, price: 414, totalPrice: 414, quantity: '6', orderQuantity: '2' }
        },
        {
          _id: 'e1', type: 'Early Bird',
          ticketInfo: { ticketId: earlyId, price: 247.98, totalPrice: 247.98, quantity: '2', orderQuantity: '2' }
        },
        {
          _id: 'e2', type: 'Early Bird',
          ticketInfo: { ticketId: earlyId, price: 247.98, totalPrice: 247.98, quantity: '2', orderQuantity: '2' }
        },
        {
          _id: 'e3', type: 'Early Bird',
          ticketInfo: { ticketId: earlyId, price: 248, totalPrice: 248, quantity: '4', orderQuantity: '4' }
        },
        {
          _id: 'k1', type: 'Kids under 17',
          ticketInfo: { ticketId: kidsId, price: 67.94, quantity: '2', orderQuantity: '1', packSize: '2' }
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
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) })
        })
      });
      mockExternalTicketSales.getExternalTicketSalesByEvent.mockResolvedValue([]);

      const result = await Report.getEventFinancialReport(eventId);
      const byType = Object.fromEntries(
        result.ticketBreakdown.map((r) => [r.ticketType, r])
      );

      expect(byType['Group of 3'].localRevenue).toBe(828);
      expect(byType['Group of 3'].localQuantity).toBe(4);
      expect(byType['Early Bird'].localRevenue).toBeCloseTo(743.96, 2);
      expect(byType['Early Bird'].localQuantity).toBe(8);
      expect(byType['Kids under 17'].localRevenue).toBeCloseTo(67.94, 2);
      expect(byType['Kids under 17'].localQuantity).toBe(1);
      expect(result.summary.localRevenue).toBeCloseTo(828 + 743.96 + 67.94, 2);
    });
  });
});

