/**
 * Setting Model Unit Tests
 *
 * Tests for:
 * - createSetting
 * - getSetting
 * - getSettingById
 * - updateSettingById
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockSettingModel = jest.fn();
mockSettingModel.find = jest.fn();
mockSettingModel.findById = jest.fn();
mockSettingModel.findOneAndUpdate = jest.fn();

const mockModel = {
  Setting: mockSettingModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Setting;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Setting: mockSettingModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Setting = await import('../../../model/setting.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Setting Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingModel.mockClear();
    mockSettingModel.find.mockClear();
    mockSettingModel.findById.mockClear();
    mockSettingModel.findOneAndUpdate.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createSetting', () => {
    it('should create a new setting', async () => {
      // Arrange
      const aboutSection = 'About us section content';
      const contactInfo = {
        email: 'contact@example.com',
        phone: '+1234567890'
      };
      const socialMedia = {
        facebook: 'https://facebook.com/example',
        twitter: 'https://twitter.com/example'
      };
      const otherInfo = {
        customField: 'custom value'
      };

      const savedSettingData = {
        _id: new mongoose.Types.ObjectId(),
        aboutSection: aboutSection,
        contactInfo: contactInfo,
        socialMedia: socialMedia,
        otherInfo: otherInfo
      };

      const mockSavedSetting = {
        _id: savedSettingData._id,
        aboutSection: aboutSection,
        contactInfo: contactInfo,
        socialMedia: socialMedia,
        otherInfo: otherInfo,
        save: jest.fn().mockResolvedValue(savedSettingData)
      };

      mockSettingModel.mockImplementation(() => mockSavedSetting);

      // Act
      const result = await Setting.createSetting(aboutSection, contactInfo, socialMedia, otherInfo);

      // Assert
      expect(mockSettingModel).toHaveBeenCalled();
      expect(mockSavedSetting.save).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.aboutSection).toBe(aboutSection);
    });

    it('should create setting without otherInfo', async () => {
      // Arrange
      const aboutSection = 'About us section content';
      const contactInfo = {};
      const socialMedia = {};

      const savedSettingData = {
        _id: new mongoose.Types.ObjectId(),
        aboutSection: aboutSection,
        contactInfo: contactInfo,
        socialMedia: socialMedia,
        otherInfo: null
      };

      const mockSavedSetting = {
        _id: savedSettingData._id,
        aboutSection: aboutSection,
        contactInfo: contactInfo,
        socialMedia: socialMedia,
        otherInfo: null,
        save: jest.fn().mockResolvedValue(savedSettingData)
      };

      mockSettingModel.mockImplementation(() => mockSavedSetting);

      // Act
      const result = await Setting.createSetting(aboutSection, contactInfo, socialMedia);

      // Assert
      expect(result).toBeDefined();
      expect(result.otherInfo).toBeNull();
    });
  });

  describe('getSetting', () => {
    it('should retrieve all settings', async () => {
      // Arrange
      const mockSettings = [
        {
          _id: new mongoose.Types.ObjectId(),
          aboutSection: 'About us',
          contactInfo: {}
        }
      ];

      mockSettingModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSettings)
      });

      // Act
      const result = await Setting.getSetting();

      // Assert
      expect(mockSettingModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockError = new Error('Database error');
      mockSettingModel.find.mockReturnValue({
        exec: jest.fn().mockRejectedValue(mockError)
      });

      // Act
      const result = await Setting.getSetting();

      // Assert
      expect(result).toBe(mockError);
    });
  });

  describe('getSettingById', () => {
    it('should retrieve setting by ID', async () => {
      // Arrange
      const settingId = new mongoose.Types.ObjectId();
      const mockSetting = {
        _id: settingId,
        aboutSection: 'About us',
        contactInfo: {}
      };

      mockSettingModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockSetting])
      });

      // Act
      const result = await Setting.getSettingById(settingId);

      // Assert
      expect(mockSettingModel.find).toHaveBeenCalledWith({ _id: settingId });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('updateSettingById', () => {
    it('should update setting successfully', async () => {
      // Arrange
      const settingId = new mongoose.Types.ObjectId();
      const updateData = {
        aboutSection: 'Updated about section',
        contactInfo: {
          email: 'newemail@example.com'
        }
      };

      const updatedSetting = {
        _id: settingId,
        ...updateData
      };

      mockSettingModel.findOneAndUpdate.mockResolvedValue(updatedSetting);

      // Act
      const result = await Setting.updateSettingById(settingId, updateData);

      // Assert
      expect(mockSettingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: settingId },
        { $set: updateData },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.aboutSection).toBe('Updated about section');
    });

    it('should handle update errors', async () => {
      // Arrange
      const settingId = new mongoose.Types.ObjectId();
      const updateData = {
        aboutSection: 'Updated'
      };

      const mockError = new Error('Update failed');
      mockSettingModel.findOneAndUpdate.mockRejectedValue(mockError);

      // Act
      const result = await Setting.updateSettingById(settingId, updateData);

      // Assert
      expect(result).toBe(mockError);
    });
  });
});

