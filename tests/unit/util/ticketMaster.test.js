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
  updateTicketById: jest.fn(),
  upsertChildTicketQR: jest.fn()
};

const mockCommon = {
  generateICS: jest.fn(),
  generateQRCode: jest.fn(),
  loadEmailTemplate: jest.fn(),
  resolveBrandingContactEmail: jest.fn()
};

const mockLogger = {
  error: jest.fn()
};

const mockPlatformSettings = {
  resolvePlatformBrandingAsync: jest.fn()
};

// Use dynamic imports for ES modules
let ticketMaster;

beforeAll(async () => {
  // Use absolute paths for mocking
  const ticketPath = resolve(__dirname, '../../../model/ticket.js');
  const commonPath = resolve(__dirname, '../../../util/common.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');
  const platformSettingsPath = resolve(__dirname, '../../../util/platformSettings.js');

  jest.unstable_mockModule(ticketPath, () => ({
    default: mockTicket,
    updateTicketById: mockTicket.updateTicketById,
    upsertChildTicketQR: mockTicket.upsertChildTicketQR
  }));

  jest.unstable_mockModule(commonPath, () => ({
    default: mockCommon,
    generateICS: mockCommon.generateICS,
    generateQRCode: mockCommon.generateQRCode,
    loadEmailTemplate: mockCommon.loadEmailTemplate,
    resolveBrandingContactEmail: mockCommon.resolveBrandingContactEmail
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  jest.unstable_mockModule(platformSettingsPath, () => ({
    resolvePlatformBrandingAsync: mockPlatformSettings.resolvePlatformBrandingAsync
  }));

  mockPlatformSettings.resolvePlatformBrandingAsync.mockResolvedValue({
    tier: 'default',
    companyName: 'Finnep',
    companyLogo: 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
    brandingContactEmail: 'support@example.com',
    businessId: '3579764-6',
    socialMedidFB: 'https://www.facebook.com/profile.php?id=61565375592900',
    socialMedidLN: 'https://www.linkedin.com/company/105069196/admin/dashboard/'
  });

  // Set environment variables
  process.env.EMAIL_USERNAME = process.env.EMAIL_USERNAME || 'test@example.com';

  ticketMaster = await import('../../../util/ticketMaster.js');
});

describe('Ticket Master', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicket.updateTicketById.mockClear();
    mockTicket.upsertChildTicketQR.mockClear();
    mockCommon.generateICS.mockClear();
    mockCommon.generateQRCode.mockClear();
    mockCommon.loadEmailTemplate.mockClear();
    mockCommon.resolveBrandingContactEmail.mockClear();
    mockCommon.resolveBrandingContactEmail.mockReturnValue('support@example.com');
    mockPlatformSettings.resolvePlatformBrandingAsync.mockClear();
    mockPlatformSettings.resolvePlatformBrandingAsync.mockResolvedValue({
      tier: 'default',
      companyName: 'Finnep',
      companyLogo: 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
      brandingContactEmail: 'support@example.com',
      businessId: '3579764-6',
      socialMedidFB: 'https://www.facebook.com/profile.php?id=61565375592900',
      socialMedidLN: 'https://www.linkedin.com/company/105069196/admin/dashboard/'
    });
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
        id: 'ticket_123',
        ticketInfo: {
          quantity: '1',
          basePrice: '10.111',
          serviceFee: '0',
          entertainmentTax: '0',
          serviceTax: '0',
          vatRate: '0',
          orderFee: '0'
        }
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
        id: 'ticket_123',
        ticketInfo: {
          quantity: '1',
          basePrice: '10.111',
          serviceFee: '0',
          entertainmentTax: '0',
          serviceTax: '0',
          vatRate: '0',
          orderFee: '0'
        }
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
      const templateVariables = mockCommon.loadEmailTemplate.mock.calls[0][1];
      expect(templateVariables.totalAmount).toMatch(/^\d+\.\d{2}\s\S+$/);
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

      // Act / Assert — errors propagate (catch rethrows)
      await expect(
        ticketMaster.createEmailPayload(mockEvent, mockTicketInfo, ticketFor, otp)
      ).rejects.toThrow('QR Code generation failed');
    });

    it('should attach guest QR codes for multi-ticket orders', async () => {
      const mockEvent = {
        _id: 'event_123',
        eventTitle: 'Group Event',
        eventPromotionPhoto: 'https://example.com/photo.jpg',
        otherInfo: {}
      };

      const mockTicketInfo = {
        id: 'ticket_group_123',
        ticketInfo: {
          quantity: '3'
        }
      };

      const ticketFor = 'group@example.com';
      const otp = 'GROUP123';
      const mockICS = 'BEGIN:VCALENDAR...';
      const mockQRCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
      const mockTemplate = '<html>Default Template</html>';

      mockCommon.generateICS.mockResolvedValue(mockICS);
      mockCommon.generateQRCode.mockResolvedValue(mockQRCode);
      mockCommon.loadEmailTemplate.mockResolvedValue(mockTemplate);
      mockTicket.updateTicketById.mockResolvedValue({});
      mockTicket.upsertChildTicketQR.mockResolvedValue({});

      const result = await ticketMaster.createEmailPayload(
        mockEvent,
        mockTicketInfo,
        ticketFor,
        otp
      );

      expect(mockTicket.upsertChildTicketQR).toHaveBeenCalledTimes(3);
      expect(mockCommon.generateQRCode).toHaveBeenCalledWith('ticket_group_123');
      expect(mockCommon.generateQRCode).toHaveBeenCalledWith('ticket_group_123#1');
      expect(mockCommon.generateQRCode).toHaveBeenCalledWith('ticket_group_123#2');
      expect(mockCommon.generateQRCode).toHaveBeenCalledWith('ticket_group_123#3');
      expect(result.attachments).toHaveLength(3);
      expect(result.attachments.map((a) => a.filename)).toEqual([
        'ticket-qrcode-guest-1.png',
        'ticket-qrcode-guest-2.png',
        'ticket-qrcode-guest-3.png'
      ]);
    });
  });
});

