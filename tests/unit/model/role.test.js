/**
 * Role Model Unit Tests
 *
 * Tests for:
 * - createRole
 * - getAllRole
 * - getRoleByRoleType
 * - findRoleById
 * - deleteRole
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockRoleModel = jest.fn();
mockRoleModel.find = jest.fn();
mockRoleModel.findOne = jest.fn();
mockRoleModel.findById = jest.fn();
mockRoleModel.deleteOne = jest.fn();

const mockModel = {
  Role: mockRoleModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Role;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Role: mockRoleModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Role = await import('../../../model/role.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Role Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoleModel.mockClear();
    mockRoleModel.find.mockClear();
    mockRoleModel.findOne.mockClear();
    mockRoleModel.findById.mockClear();
    mockRoleModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createRole', () => {
    it('should create a new role', async () => {
      // Arrange
      const roleType = 'admin';

      const savedRoleData = {
        _id: new mongoose.Types.ObjectId(),
        roleType: roleType
      };

      const mockSavedRole = {
        _id: savedRoleData._id,
        roleType: roleType,
        save: jest.fn().mockResolvedValue(savedRoleData)
      };

      mockRoleModel.mockImplementation(() => mockSavedRole);

      // Act
      const result = await Role.createRole(roleType);

      // Assert
      expect(mockRoleModel).toHaveBeenCalledWith({ roleType: roleType });
      expect(mockSavedRole.save).toHaveBeenCalled();
      // Note: createRole calls saveToDB which doesn't return the saved role
      // It just saves and returns undefined, so we verify the save was called
      expect(mockSavedRole.save).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const roleType = null;

      const mockError = new Error('Validation failed');
      const mockRoleInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockRoleModel.mockImplementation(() => mockRoleInstance);

      // Act & Assert
      await expect(
        Role.createRole(roleType)
      ).rejects.toThrow();
    });
  });

  describe('getAllRole', () => {
    it('should retrieve all roles', async () => {
      // Arrange
      const mockRoles = [
        {
          _id: new mongoose.Types.ObjectId(),
          roleType: 'admin'
        },
        {
          _id: new mongoose.Types.ObjectId(),
          roleType: 'staff'
        }
      ];

      mockRoleModel.find.mockResolvedValue(mockRoles);

      // Act
      const result = await Role.getAllRole();

      // Assert
      expect(mockRoleModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockError = new Error('Database error');
      mockRoleModel.find.mockRejectedValue(mockError);

      // Act
      const result = await Role.getAllRole();

      // Assert
      expect(result).toHaveProperty('error');
    });
  });

  describe('getRoleByRoleType', () => {
    it('should retrieve role by role type', async () => {
      // Arrange
      const roleType = 'admin';
      const mockRole = {
        _id: new mongoose.Types.ObjectId(),
        roleType: roleType
      };

      mockRoleModel.findOne.mockResolvedValue(mockRole);

      // Act
      const result = await Role.getRoleByRoleType(roleType);

      // Assert
      expect(mockRoleModel.findOne).toHaveBeenCalledWith({ 'roleType': roleType });
      expect(result).toBeDefined();
      expect(result.roleType).toBe(roleType);
    });

    it('should return null for non-existent role type', async () => {
      // Arrange
      const roleType = 'nonexistent';

      mockRoleModel.findOne.mockResolvedValue(null);

      // Act
      const result = await Role.getRoleByRoleType(roleType);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findRoleById', () => {
    it('should retrieve role by ID', async () => {
      // Arrange
      const roleId = new mongoose.Types.ObjectId();
      const mockRole = {
        _id: roleId,
        roleType: 'admin'
      };

      mockRoleModel.findById.mockResolvedValue(mockRole);

      // Act
      const result = await Role.findRoleById(roleId);

      // Assert
      expect(mockRoleModel.findById).toHaveBeenCalledWith(roleId);
      expect(result).toBeDefined();
      expect(result._id).toEqual(roleId);
    });
  });

  describe('deleteRole', () => {
    it('should delete role by role type', async () => {
      // Arrange
      const roleType = 'admin';

      mockRoleModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      // Act
      const result = await Role.deleteRole(roleType);

      // Assert
      expect(mockRoleModel.deleteOne).toHaveBeenCalledWith({ 'roleType': roleType });
      expect(result).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const roleType = 'admin';
      const mockError = new Error('Delete failed');
      mockRoleModel.deleteOne.mockRejectedValue(mockError);

      // Act
      const result = await Role.deleteRole(roleType);

      // Assert
      expect(result).toHaveProperty('error');
    });
  });
});

