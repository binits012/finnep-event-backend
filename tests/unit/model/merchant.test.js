/**
 * Merchant Model Unit Tests
 *
 * Tests for:
 * - createMerchant
 * - getMerchantById
 * - getMerchantByMerchantId
 * - getAllMerchants
 * - updateMerchantById
 * - deleteMerchantById
 * - genericSearchMerchant
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockMerchantModel = jest.fn();
mockMerchantModel.find = jest.fn();
mockMerchantModel.findById = jest.fn();
mockMerchantModel.findOne = jest.fn();
mockMerchantModel.findOneAndUpdate = jest.fn();
mockMerchantModel.findByIdAndUpdate = jest.fn();
mockMerchantModel.findByIdAndDelete = jest.fn();
mockMerchantModel.deleteOne = jest.fn();

const mockModel = {
  Merchant: mockMerchantModel
};

const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

// Use dynamic imports for ES modules
let Merchant;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Merchant: mockMerchantModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error,
    info: mockLogger.info
  }));

  Merchant = await import('../../../model/merchant.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Merchant Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMerchantModel.mockClear();
    mockMerchantModel.find.mockClear();
    mockMerchantModel.findById.mockClear();
    mockMerchantModel.findOne.mockClear();
    mockMerchantModel.findOneAndUpdate.mockClear();
    mockMerchantModel.findByIdAndUpdate.mockClear();
    mockMerchantModel.findByIdAndDelete.mockClear();
    mockMerchantModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
  });

  describe('createMerchant', () => {
    it('should create a new merchant', async () => {
      // Arrange
      const merchantData = {
        merchantId: 'merchant_123',
        name: 'Test Merchant',
        orgName: 'Test Organization',
        country: 'Finland',
        code: 'FI',
        email: 'merchant@example.com',
        status: 'active',
        stripeAccount: 'acct_test123'
      };

      const savedMerchantData = {
        _id: new mongoose.Types.ObjectId(),
        ...merchantData
      };

      const mockSavedMerchant = {
        _id: savedMerchantData._id,
        ...merchantData,
        save: jest.fn().mockResolvedValue(savedMerchantData)
      };

      mockMerchantModel.mockImplementation(() => mockSavedMerchant);

      // Act
      const result = await Merchant.createMerchant(merchantData);

      // Assert
      expect(mockMerchantModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidMerchantData = {
        // Missing required fields
        merchantId: null
      };

      const mockError = new Error('Validation failed');
      const mockMerchantInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockMerchantModel.mockImplementation(() => mockMerchantInstance);

      // Act & Assert
      await expect(
        Merchant.createMerchant(invalidMerchantData)
      ).rejects.toThrow();
    });
  });

  describe('getMerchantById', () => {
    it('should retrieve merchant by MongoDB ID', async () => {
      // Arrange
      const merchantId = new mongoose.Types.ObjectId();
      const mockMerchant = {
        _id: merchantId,
        merchantId: 'merchant_123',
        name: 'Test Merchant'
      };

      mockMerchantModel.findById.mockResolvedValue(mockMerchant);

      // Act
      const result = await Merchant.getMerchantById(merchantId);

      // Assert
      expect(mockMerchantModel.findById).toHaveBeenCalledWith(merchantId);
      expect(result).toBeDefined();
      expect(result._id).toEqual(merchantId);
    });

    it('should return null for non-existent merchant', async () => {
      // Arrange
      const nonExistentId = new mongoose.Types.ObjectId();

      mockMerchantModel.findById.mockResolvedValue(null);

      // Act
      const result = await Merchant.getMerchantById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getMerchantByMerchantId', () => {
    it('should retrieve merchant by merchantId', async () => {
      // Arrange
      const merchantId = 'merchant_123';
      const mockMerchant = {
        _id: new mongoose.Types.ObjectId(),
        merchantId: merchantId,
        name: 'Test Merchant'
      };

      mockMerchantModel.findOne.mockResolvedValue(mockMerchant);

      // Act
      const result = await Merchant.getMerchantByMerchantId(merchantId);

      // Assert
      expect(mockMerchantModel.findOne).toHaveBeenCalledWith({ merchantId: merchantId });
      expect(result).toBeDefined();
      expect(result.merchantId).toBe(merchantId);
    });
  });

  describe('getAllMerchants', () => {
    it('should retrieve all merchants', async () => {
      // Arrange
      const mockMerchants = [
        {
          _id: new mongoose.Types.ObjectId(),
          merchantId: 'merchant_1',
          name: 'Merchant 1'
        },
        {
          _id: new mongoose.Types.ObjectId(),
          merchantId: 'merchant_2',
          name: 'Merchant 2'
        }
      ];

      mockMerchantModel.find.mockResolvedValue(mockMerchants);

      // Act
      const result = await Merchant.getAllMerchants();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('updateMerchantById', () => {
    it('should update merchant successfully', async () => {
      // Arrange
      const merchantId = new mongoose.Types.ObjectId();
      const updateData = {
        name: 'Updated Merchant Name',
        status: 'inactive'
      };

      const updatedMerchant = {
        _id: merchantId,
        ...updateData
      };

      mockMerchantModel.findByIdAndUpdate.mockResolvedValue(updatedMerchant);

      // Act
      const result = await Merchant.updateMerchantById(merchantId, updateData);

      // Assert
      expect(mockMerchantModel.findByIdAndUpdate).toHaveBeenCalledWith(
        merchantId,
        expect.objectContaining(updateData),
        { new: true, runValidators: true }
      );
      expect(result).toBeDefined();
      expect(result.name).toBe(updateData.name);
    });
  });

  describe('deleteMerchantById', () => {
    it('should delete merchant successfully', async () => {
      // Arrange
      const merchantId = new mongoose.Types.ObjectId();
      const deletedMerchant = {
        _id: merchantId,
        merchantId: 'merchant_123',
        name: 'Deleted Merchant'
      };

      mockMerchantModel.findByIdAndDelete = jest.fn().mockResolvedValue(deletedMerchant);

      // Act
      const result = await Merchant.deleteMerchantById(merchantId);

      // Assert
      expect(mockMerchantModel.findByIdAndDelete).toHaveBeenCalledWith(merchantId);
      expect(result).toBeDefined();
      expect(result._id).toEqual(merchantId);
    });
  });

  describe('genericSearchMerchant', () => {
    it('should search merchants by multiple terms', async () => {
      // Arrange
      const searchTerms = ['merchant_123', 'Test Merchant'];
      const mockMerchants = [
        {
          _id: new mongoose.Types.ObjectId(),
          merchantId: 'merchant_123',
          name: 'Test Merchant'
        }
      ];

      mockMerchantModel.find.mockResolvedValue(mockMerchants);

      // Act
      const result = await Merchant.genericSearchMerchant(...searchTerms);

      // Assert
      expect(mockMerchantModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.any(Array) })
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array for no search terms', async () => {
      // Arrange
      const searchTerms = [];

      // Act
      const result = await Merchant.genericSearchMerchant(...searchTerms);

      // Assert
      expect(result).toEqual([]);
    });

    it('should filter out null and empty search terms', async () => {
      // Arrange
      const searchTerms = ['merchant_123', null, '', 'Test Merchant'];

      model.Merchant.find = jest.fn().mockResolvedValue([]);

      // Act
      const result = await Merchant.genericSearchMerchant(...searchTerms);

      // Assert
      // Should only use valid search terms
      expect(mockMerchantModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});

