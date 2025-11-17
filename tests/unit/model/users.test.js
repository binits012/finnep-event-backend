/**
 * User Model Unit Tests
 *
 * Tests for:
 * - createUser
 * - loginCheck
 * - getAllUsers
 * - getUserByName
 * - getUsersByRole
 * - updateUserPassword
 * - deleteUserById
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockUserModel = jest.fn();
mockUserModel.find = jest.fn();
mockUserModel.findById = jest.fn();
mockUserModel.findOne = jest.fn();
mockUserModel.findOneAndUpdate = jest.fn();
mockUserModel.deleteOne = jest.fn();

const mockModel = {
  User: mockUserModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let User;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    User: mockUserModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  User = await import('../../../model/users.js');
  model = await import('../../../model/mongoModel.js');
});

describe('User Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserModel.mockClear();
    mockUserModel.find.mockClear();
    mockUserModel.findById.mockClear();
    mockUserModel.findOne.mockClear();
    mockUserModel.findOneAndUpdate.mockClear();
    mockUserModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      // Arrange
      const userData = {
        name: 'test@example.com',
        pwd: 'hashedPassword',
        role: new mongoose.Types.ObjectId(),
        active: true,
        notificationAllowed: true
      };

      const savedUserData = {
        _id: new mongoose.Types.ObjectId(),
        ...userData
      };

      const mockSavedUser = {
        _id: savedUserData._id,
        ...userData,
        save: jest.fn().mockResolvedValue(savedUserData)
      };

      mockUserModel.mockImplementation(() => mockSavedUser);

      // Act
      const result = await User.createUser(
        userData.name,
        userData.pwd,
        userData.role,
        userData.active,
        userData.notificationAllowed
      );

      // Assert
      expect(mockUserModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidUserData = {
        // Missing required fields
        name: '',
        pwd: null
      };

      const mockError = new Error('Validation failed');
      const mockUserInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockUserModel.mockImplementation(() => mockUserInstance);

      // Act & Assert
      await expect(
        User.createUser(
          invalidUserData.name,
          invalidUserData.pwd,
          null,
          true,
          true
        )
      ).rejects.toThrow();
    });
  });

  describe('loginCheck', () => {
    it('should return user for valid credentials', async () => {
      // Arrange
      const username = 'test@example.com';
      const password = 'correctPassword';

      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: username,
        active: true,
        role: { roleType: 'admin' },
        comparePassword: jest.fn().mockResolvedValue(true)
      };

      mockUserModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUser)
      });

      // Act
      const result = await User.loginCheck(username, password);

      // Assert
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ name: username });
      expect(result).toBeDefined();
      expect(result.name).toBe(username);
    });

    it('should return null for invalid password', async () => {
      // Arrange
      const username = 'test@example.com';
      const password = 'wrongPassword';

      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: username,
        active: true,
        role: { roleType: 'admin' },
        comparePassword: jest.fn().mockResolvedValue(false)
      };

      mockUserModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUser)
      });

      // Act
      const result = await User.loginCheck(username, password);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for inactive user', async () => {
      // Arrange
      const username = 'test@example.com';
      const password = 'correctPassword';

      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: username,
        active: false,
        role: { roleType: 'admin' }
      };

      mockUserModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUser)
      });

      // Act
      const result = await User.loginCheck(username, password);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      // Arrange
      const username = 'nonexistent@example.com';
      const password = 'password';

      mockUserModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null)
      });

      // Act
      const result = await User.loginCheck(username, password);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getAllUsers', () => {
    it('should retrieve all users without passwords', async () => {
      // Arrange
      const mockUsers = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'user1@example.com',
          role: { roleType: 'admin' }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'user2@example.com',
          role: { roleType: 'staff' }
        }
      ];

      mockUserModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockResolvedValue(mockUsers)
          })
        })
      });

      // Act
      const result = await User.getAllUsers();

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('getUserByName', () => {
    it('should retrieve user by username', async () => {
      // Arrange
      const username = 'test@example.com';
      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: username,
        role: { roleType: 'admin' }
      };

      mockUserModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUser)
      });

      // Act
      const result = await User.getUserByName(username);

      // Assert
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ name: username });
      expect(result).toBeDefined();
      expect(result.name).toBe(username);
    });
  });

  describe('getUsersByRole', () => {
    it('should retrieve users by admin role', async () => {
      // Arrange
      const roleType = 'admin';
      const mockUsers = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'admin1@example.com',
          role: { roleType: 'admin' }
        }
      ];

      mockUserModel.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUsers)
      });

      // Act
      const result = await User.getUsersByRole(roleType);

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('updateUserPassword', () => {
    it('should update user password with plain text', async () => {
      // Arrange
      const filter = { name: 'test@example.com' };
      const update = { pwd: 'newPlainPassword' };

      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: 'test@example.com',
        pwd: 'oldHashedPassword',
        hashPassword: jest.fn().mockResolvedValue('newHashedPassword')
      };

      mockUserModel.findOne.mockResolvedValue(mockUser);
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        ...mockUser,
        pwd: 'newHashedPassword'
      });

      // Act
      const result = await User.updateUserPassword(filter, update);

      // Assert
      expect(mockUser.hashPassword).toHaveBeenCalledWith(update.pwd);
      expect(result).toBeDefined();
    });

    it('should not re-hash already hashed password', async () => {
      // Arrange
      const filter = { name: 'test@example.com' };
      const update = { pwd: 'alreadyHashedPassword' };

      const mockUser = {
        _id: new mongoose.Types.ObjectId(),
        name: 'test@example.com',
        pwd: 'alreadyHashedPassword'
      };

      mockUserModel.findOne.mockResolvedValue(mockUser);
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUser);

      // Act
      const result = await User.updateUserPassword(filter, update);

      // Assert
      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        filter,
        { pwd: mockUser },
        { new: true }
      );
      expect(result).toBeDefined();
    });
  });

  describe('deleteUserById', () => {
    it('should delete user by ID', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();
      const deletedUser = {
        _id: userId,
        name: 'test@example.com'
      };

      mockUserModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      // Act
      const result = await User.deleteUserById(userId);

      // Assert
      expect(mockUserModel.deleteOne).toHaveBeenCalledWith({ _id: userId });
      expect(result).toBeDefined();
    });
  });
});

