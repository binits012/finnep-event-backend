/**
 * Merchant Handler Unit Tests
 *
 * Tests for:
 * - handleMerchantMessage
 * - handleMerchantCreated
 * - handleMerchantUpdated
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockMerchant = {
  createMerchant: jest.fn(),
  getMerchantByMerchantId: jest.fn(),
  updateMerchantById: jest.fn()
};

const mockInbox = {
  saveMessage: jest.fn(),
  isProcessed: jest.fn(),
  markProcessed: jest.fn()
};

const mockCommon = {
  loadEmailTemplateForMerchant: jest.fn()
};

const mockSendMail = {
  forward: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Use dynamic imports for ES modules
let merchantHandler;
let Merchant;
let inboxModel;
let common;
let sendMail;
let logger;

beforeAll(async () => {
  // Use absolute paths for mocking
  const merchantPath = resolve(__dirname, '../../../../model/merchant.js');
  const inboxMessagePath = resolve(__dirname, '../../../../model/inboxMessage.js');
  const commonPath = resolve(__dirname, '../../../../util/common.js');
  const sendMailPath = resolve(__dirname, '../../../../util/sendMail.js');
  const loggerPath = resolve(__dirname, '../../../../model/logger.js');

  jest.unstable_mockModule(merchantPath, () => ({
    default: mockMerchant,
    createMerchant: mockMerchant.createMerchant,
    getMerchantByMerchantId: mockMerchant.getMerchantByMerchantId,
    updateMerchantById: mockMerchant.updateMerchantById
  }));

  jest.unstable_mockModule(inboxMessagePath, () => ({
    inboxModel: mockInbox
  }));

  jest.unstable_mockModule(commonPath, () => ({
    default: mockCommon,
    loadEmailTemplateForMerchant: mockCommon.loadEmailTemplateForMerchant
  }));

  jest.unstable_mockModule(sendMailPath, () => ({
    default: mockSendMail,
    forward: mockSendMail.forward
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    info: mockLogger.info,
    error: mockLogger.error,
    warn: mockLogger.warn
  }));

  merchantHandler = await import('../../../../rabbitMQ/handlers/merchantHandler.js');
  Merchant = await import('../../../../model/merchant.js');
  inboxModel = (await import('../../../../model/inboxMessage.js')).inboxModel;
  common = await import('../../../../util/common.js');
  sendMail = await import('../../../../util/sendMail.js');
  logger = await import('../../../../model/logger.js');
});

describe('Merchant Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMerchant.createMerchant.mockClear();
    mockMerchant.getMerchantByMerchantId.mockClear();
    mockMerchant.updateMerchantById.mockClear();
    mockInbox.saveMessage.mockClear();
    mockInbox.isProcessed.mockClear();
    mockInbox.markProcessed.mockClear();
    mockCommon.loadEmailTemplateForMerchant.mockClear();
    mockSendMail.forward.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  describe('handleMerchantMessage', () => {
    it('should handle merchant.created message', async () => {
      // Arrange
      const message = {
        type: 'merchant.created',
        merchantId: 'merchant_123',
        orgName: 'Test Organization',
        name: 'Test Merchant',
        email: 'merchant@example.com',
        country: 'Finland',
        metaData: {
          causationId: 'msg_123'
        }
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.createMerchant.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        merchantId: 'merchant_123'
      });
      mockCommon.loadEmailTemplateForMerchant.mockResolvedValue('<html>Welcome</html>');
      mockSendMail.forward.mockResolvedValue(true);

      // Act
      await merchantHandler.handleMerchantMessage(message);

      // Assert
      expect(mockInbox.isProcessed).toHaveBeenCalledWith('msg_123');
      expect(mockMerchant.createMerchant).toHaveBeenCalled();
    });

    it('should handle merchant.updated message', async () => {
      // Arrange
      const message = {
        type: 'merchant.updated',
        merchantId: 'merchant_123',
        name: 'Updated Merchant Name',
        metaData: {
          causationId: 'msg_456'
        }
      };

      const existingMerchant = {
        _id: '507f1f77bcf86cd799439011',
        merchantId: 'merchant_123'
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(existingMerchant);
      mockMerchant.updateMerchantById.mockResolvedValue({
        ...existingMerchant,
        name: 'Updated Merchant Name'
      });
      mockInbox.markProcessed.mockResolvedValue(true);

      // Act
      await merchantHandler.handleMerchantMessage(message);

      // Assert
      expect(mockMerchant.getMerchantByMerchantId).toHaveBeenCalledWith('merchant_123');
      expect(mockMerchant.updateMerchantById).toHaveBeenCalled();
    });

    it('should map stripe_account to stripeAccount on merchant.updated', async () => {
      const message = {
        type: 'merchant.updated',
        merchantId: 'merchant_123',
        stripe_account: 'acct_new_connected',
        metaData: {
          causationId: 'msg_789'
        }
      };

      const existingMerchant = {
        _id: '507f1f77bcf86cd799439011',
        merchantId: 'merchant_123',
        stripeAccount: 'acct_platform'
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(existingMerchant);
      mockMerchant.updateMerchantById.mockResolvedValue({
        ...existingMerchant,
        stripeAccount: 'acct_new_connected'
      });
      mockInbox.markProcessed.mockResolvedValue(true);

      await merchantHandler.handleMerchantMessage(message);

      expect(mockMerchant.updateMerchantById).toHaveBeenCalledWith(
        existingMerchant._id,
        expect.objectContaining({
          stripeAccount: 'acct_new_connected'
        })
      );
      const updatePayload = mockMerchant.updateMerchantById.mock.calls[0][1];
      expect(updatePayload.stripe_account).toBeUndefined();
      expect(updatePayload.metaData).toBeUndefined();
    });

    it('should clear bankingInfo when EMS sends null bank fields on merchant.updated', async () => {
      const message = {
        type: 'merchant.updated',
        merchantId: 'merchant_123',
        stripe_account: 'acct_connected',
        bank_account: null,
        bic_swift: null,
        account_holder_name: null,
        bank_name: null,
        bank_address: null,
        metaData: {
          causationId: 'msg_bank_clear'
        }
      };

      const existingMerchant = {
        _id: '507f1f77bcf86cd799439011',
        merchantId: 'merchant_123',
        stripeAccount: 'acct_platform',
        bankingInfo: {
          bank_account: 'FI2112345678901234',
          bank_name: 'Old Bank'
        }
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});
      mockMerchant.getMerchantByMerchantId.mockResolvedValue(existingMerchant);
      mockMerchant.updateMerchantById.mockResolvedValue(existingMerchant);
      mockInbox.markProcessed.mockResolvedValue(true);

      await merchantHandler.handleMerchantMessage(message);

      expect(mockMerchant.updateMerchantById).toHaveBeenCalledWith(
        existingMerchant._id,
        expect.objectContaining({
          stripeAccount: 'acct_connected',
          bankingInfo: {}
        })
      );
    });

    it('should skip already processed messages', async () => {
      // Arrange
      const message = {
        type: 'merchant.created',
        merchantId: 'merchant_123',
        metaData: {
          causationId: 'msg_123'
        }
      };

      mockInbox.isProcessed.mockResolvedValue(true);

      // Act
      await merchantHandler.handleMerchantMessage(message);

      // Assert
      expect(mockMerchant.createMerchant).not.toHaveBeenCalled();
    });

    it('should throw error for invalid message format', async () => {
      // Arrange
      const message = null;

      // Act & Assert
      await expect(
        merchantHandler.handleMerchantMessage(message)
      ).rejects.toThrow('Message must be an object');
    });

    it('should throw error for unknown message type', async () => {
      // Arrange
      const message = {
        type: 'merchant.unknown',
        merchantId: 'merchant_123',
        metaData: {
          causationId: 'msg_123'
        }
      };

      mockInbox.isProcessed.mockResolvedValue(false);
      mockInbox.saveMessage.mockResolvedValue({});

      // Act & Assert
      await expect(
        merchantHandler.handleMerchantMessage(message)
      ).rejects.toThrow('Unknown message type');
    });
  });
});

