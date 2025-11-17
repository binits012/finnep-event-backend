/**
 * Send Mail Utilities Unit Tests
 *
 * Tests for:
 * - forward
 * - retryForward
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockTransport = {
  sendMail: jest.fn()
};

const mockTicketReport = {
  save: jest.fn()
};

const mockTicketReportModel = jest.fn().mockImplementation(() => mockTicketReport);
mockTicketReportModel.findByIdAndUpdate = jest.fn();

const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

// Use dynamic imports for ES modules
let sendMail;

  beforeAll(async () => {
  // Use absolute paths for mocking
  const reportingPath = resolve(__dirname, '../../../model/reporting.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule('nodemailer', () => ({
    createTransport: jest.fn(() => mockTransport)
  }));

  jest.unstable_mockModule(reportingPath, () => ({
    TicketReport: mockTicketReportModel,
    default: mockTicketReportModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error,
    info: mockLogger.info
  }));

  sendMail = await import('../../../util/sendMail.js');
});

describe('Send Mail Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransport.sendMail.mockClear();
    mockTicketReport.save.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();

    // Set SEND_MAIL env to true for tests
    process.env.SEND_MAIL = 'true';
  });

  describe('forward', () => {
    it('should send email successfully', async () => {
      // Arrange
      const emailData = {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>'
      };

      const mockResult = {
        messageId: 'msg_123',
        accepted: [emailData.to]
      };

      mockTransport.sendMail.mockImplementation((data, callback) => {
        callback(null, mockResult);
      });

      // Act
      const result = await sendMail.forward(emailData);

      // Assert
      expect(mockTransport.sendMail).toHaveBeenCalledWith(
        emailData,
        expect.any(Function)
      );
      expect(result).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle email send errors', async () => {
      // Arrange
      const emailData = {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>'
      };

      const mockError = new Error('SMTP connection failed');
      mockTransport.sendMail.mockImplementation((data, callback) => {
        // Call callback asynchronously to match real behavior
        setImmediate(() => {
          callback(mockError, null);
        });
      });

      // Act & Assert
      await expect(
        sendMail.forward(emailData)
      ).rejects.toThrow('SMTP connection failed');

      expect(mockTicketReport.save).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not send email if SEND_MAIL is false', async () => {
      // Arrange - ensure SEND_MAIL is false
      const originalSendMail = process.env.SEND_MAIL;
      delete process.env.SEND_MAIL; // Remove the env var to simulate false
      const emailData = {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Test Email'
      };

      // Clear any previous calls
      mockTransport.sendMail.mockClear();

      // Act
      await sendMail.forward(emailData);

      // Assert
      expect(mockTransport.sendMail).not.toHaveBeenCalled();

      // Restore original value
      if (originalSendMail) {
        process.env.SEND_MAIL = originalSendMail;
      } else {
        process.env.SEND_MAIL = 'true'; // Restore default for other tests
      }
    });
  });

  describe('retryForward', () => {
    it('should retry sending email successfully', async () => {
      // Arrange
      const reportId = '507f1f77bcf86cd799439011';
      const emailData = {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>'
      };
      const retryCount = 1;

      const mockResult = {
        messageId: 'msg_123',
        accepted: [emailData.to]
      };

      mockTransport.sendMail.mockImplementation((data, callback) => {
        callback(null, mockResult);
      });

      // Mock TicketReport.findByIdAndUpdate
      const mockFindByIdAndUpdate = jest.fn().mockResolvedValue({});
      mockTicketReportModel.findByIdAndUpdate = mockFindByIdAndUpdate;

      // Act
      const result = await sendMail.retryForward(reportId, emailData, retryCount);

      // Assert
      expect(mockTransport.sendMail).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should update retry count on failure', async () => {
      // Arrange
      const reportId = '507f1f77bcf86cd799439011';
      const emailData = {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Test Email'
      };
      const retryCount = 1;

      const mockError = new Error('SMTP connection failed');
      mockTransport.sendMail.mockImplementation((data, callback) => {
        callback(mockError, null);
      });

      // Mock TicketReport.findByIdAndUpdate
      const mockFindByIdAndUpdate = jest.fn().mockResolvedValue({});
      mockTicketReportModel.findByIdAndUpdate = mockFindByIdAndUpdate;

      // Act & Assert
      await expect(
        sendMail.retryForward(reportId, emailData, retryCount)
      ).rejects.toThrow('SMTP connection failed');

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockFindByIdAndUpdate).toHaveBeenCalled();
    }, 15000);
  });
});

