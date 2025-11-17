/**
 * Ticket Master Unit Tests
 *
 * Tests for:
 * - createEmailPayload
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockTicket = {
  updateTicketById: jest.fn()
};

const mockCommon = {
  generateICS: jest.fn(),
  generateQRCode: jest.fn(),
  loadEmailTemplate: jest.fn()
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let ticketMaster;

beforeAll(async () => {
  // Use absolute paths for mocking
  const ticketPath = resolve(__dirname, '../../../model/ticket.js');
  const commonPath = resolve(__dirname, '../../../util/common.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(ticketPath, () => ({
    default: mockTicket,
    updateTicketById: mockTicket.updateTicketById
  }));

  jest.unstable_mockModule(commonPath, () => ({
    default: mockCommon,
    generateICS: mockCommon.generateICS,
    generateQRCode: mockCommon.generateQRCode,
    loadEmailTemplate: mockCommon.loadEmailTemplate
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  // Set environment variables
  process.env.EMAIL_USERNAME = process.env.EMAIL_USERNAME || 'test@example.com';

  ticketMaster = await import('../../../util/ticketMaster.js');
});

describe('Ticket Master', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicket.updateTicketById.mockClear();
    mockCommon.generateICS.mockClear();
    mockCommon.generateQRCode.mockClear();
    mockCommon.loadEmailTemplate.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createEmailPayload', () => {
    it('should create email payload with custom template', async () => {
      // Arrange
      const mockEvent = {
        _id: 'event_123',
        eventTitle: 'Test Event',
        eventPromotionalPhoto: 'https://example.com/photo.jpg',
        otherInfo: {
          emailTemplate: '$eventTitle - $ticketCode - $qrcodeData'
        }
      };

      const mockTicketInfo = {
        id: 'ticket_123'
      };

      const ticketFor = 'user@example.com';
      const otp = 'ABC123';

      const mockICS = 'BEGIN:VCALENDAR...';
      const mockQRCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';

      mockCommon.generateICS.mockResolvedValue(mockICS);
      mockCommon.generateQRCode.mockResolvedValue(mockQRCode);
      mockTicket.updateTicketById.mockResolvedValue({});

      // Act
      const result = await ticketMaster.createEmailPayload(
        mockEvent,
        mockTicketInfo,
        ticketFor,
        otp
      );

      // Assert
      expect(mockCommon.generateICS).toHaveBeenCalledWith(mockEvent, mockTicketInfo.id);
      expect(mockCommon.generateQRCode).toHaveBeenCalledWith(mockTicketInfo.id);
      expect(mockTicket.updateTicketById).toHaveBeenCalledWith(
        mockTicketInfo.id,
        {
          qrCode: mockQRCode,
          ics: mockICS
        }
      );

      expect(result).toBeDefined();
      expect(result.to).toBe(ticketFor);
      expect(result.subject).toBe(mockEvent.eventTitle);
      expect(result.html).toContain(mockEvent.eventTitle);
      expect(result.html).toContain(otp);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].filename).toBe('ticket-qrcode.png');
      expect(result.icalEvent).toBeDefined();
      expect(result.icalEvent.filename).toBe('event-ticket.ics');
    });

    it('should create email payload with default template', async () => {
      // Arrange
      const mockEvent = {
        _id: 'event_123',
        eventTitle: 'Test Event',
        eventPromotionPhoto: 'https://example.com/photo.jpg',
        otherInfo: {
          // No emailTemplate
        }
      };

      const mockTicketInfo = {
        id: 'ticket_123'
      };

      const ticketFor = 'user@example.com';
      const otp = 'ABC123';

      const mockICS = 'BEGIN:VCALENDAR...';
      const mockQRCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
      const mockTemplate = '<html>Default Template</html>';

      mockCommon.generateICS.mockResolvedValue(mockICS);
      mockCommon.generateQRCode.mockResolvedValue(mockQRCode);
      mockCommon.loadEmailTemplate.mockResolvedValue(mockTemplate);
      mockTicket.updateTicketById.mockResolvedValue({});

      // Act
      const result = await ticketMaster.createEmailPayload(
        mockEvent,
        mockTicketInfo,
        ticketFor,
        otp
      );

      // Assert
      expect(mockCommon.loadEmailTemplate).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.html).toBe(mockTemplate);
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockEvent = {
        _id: 'event_123',
        eventTitle: 'Test Event'
      };

      const mockTicketInfo = {
        id: 'ticket_123'
      };

      const ticketFor = 'user@example.com';
      const otp = 'ABC123';

      const mockError = new Error('QR Code generation failed');
      mockCommon.generateQRCode.mockRejectedValue(mockError);

      // Act
      const result = await ticketMaster.createEmailPayload(
        mockEvent,
        mockTicketInfo,
        ticketFor,
        otp
      );

      // Assert
      expect(result).toBe(mockError);
    });
  });
});

