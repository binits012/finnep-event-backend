/**
 * Token Model Unit Tests
 *
 * Tests for:
 * - createToken
 * - getTokenByUserId
 * - updateTokenByUserId
 * - removeTokenByUserId
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockJWTTokenModel = jest.fn();
mockJWTTokenModel.findOne = jest.fn();
mockJWTTokenModel.findOneAndUpdate = jest.fn();
mockJWTTokenModel.deleteOne = jest.fn();

const mockModel = {
  JWTToken: mockJWTTokenModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Token;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    JWTToken: mockJWTTokenModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Token = await import('../../../model/token.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Token Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJWTTokenModel.mockClear();
    mockJWTTokenModel.findOne.mockClear();
    mockJWTTokenModel.findOneAndUpdate.mockClear();
    mockJWTTokenModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createToken', () => {
    it('should create a new token for new user', async () => {
      // Arrange
      const token = 'jwt.token.here';
      const userId = new mongoose.Types.ObjectId();

      // Mock getTokenByUserId to return null (no existing token)
      mockJWTTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null)
      });

      const mockSavedToken = {
        _id: new mongoose.Types.ObjectId(),
        token: token,
        userId: userId,
        save: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(),
          token: token,
          userId: userId
        })
      };

      mockJWTTokenModel.mockImplementation(() => mockSavedToken);

      // Act
      const result = await Token.createToken(token, userId);

      // Assert
      expect(mockJWTTokenModel.findOne).toHaveBeenCalledWith({ userId: userId });
      expect(mockJWTTokenModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should update existing token for user', async () => {
      // Arrange
      const token = 'new.jwt.token.here';
      const userId = new mongoose.Types.ObjectId();
      const existingToken = {
        _id: new mongoose.Types.ObjectId(),
        token: 'old.jwt.token.here',
        userId: userId
      };

      // Mock getTokenByUserId to return existing token
      mockJWTTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingToken)
      });

      const updatedToken = {
        ...existingToken,
        token: token,
        isValid: true
      };

      mockJWTTokenModel.findOneAndUpdate.mockResolvedValue(updatedToken);

      // Act
      const result = await Token.createToken(token, userId);

      // Assert
      expect(mockJWTTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: userId },
        { $set: { 'token': token, 'isValid': true } },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.token).toBe(token);
    });
  });

  describe('getTokenByUserId', () => {
    it('should retrieve token by user ID', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();
      const mockToken = {
        _id: new mongoose.Types.ObjectId(),
        token: 'jwt.token.here',
        userId: userId,
        isValid: true
      };

      mockJWTTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockToken)
      });

      // Act
      const result = await Token.getTokenByUserId(userId);

      // Assert
      expect(mockJWTTokenModel.findOne).toHaveBeenCalledWith({ userId: userId });
      expect(result).toBeDefined();
      expect(result.userId).toEqual(userId);
    });

    it('should return null for user with no token', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();

      mockJWTTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null)
      });

      // Act
      const result = await Token.getTokenByUserId(userId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateTokenByUserId', () => {
    it('should update token for user', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();
      const newToken = 'updated.jwt.token.here';
      const isValid = false;

      const updatedToken = {
        _id: new mongoose.Types.ObjectId(),
        token: newToken,
        userId: userId,
        isValid: isValid
      };

      mockJWTTokenModel.findOneAndUpdate.mockResolvedValue(updatedToken);

      // Act
      const result = await Token.updateTokenByUserId(userId, newToken, isValid);

      // Assert
      expect(mockJWTTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: userId },
        { $set: { 'token': newToken, 'isValid': isValid } },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.token).toBe(newToken);
      expect(result.isValid).toBe(isValid);
    });
  });

  describe('removeTokenByUserId', () => {
    it('should remove token for user', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();

      mockJWTTokenModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      // Act
      const result = await Token.removeTokenByUserId(userId);

      // Assert
      expect(mockJWTTokenModel.deleteOne).toHaveBeenCalledWith({ userId: userId });
      expect(result).toBeDefined();
    });
  });
});

