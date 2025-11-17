/**
 * Notification Model Unit Tests
 *
 * Tests for:
 * - createNotification
 * - getAllNotification
 * - getNotificationById
 * - updateNotificationById
 * - deleteNotificationById
 * - getAllNotificationForWebsite
 * - getNotificationByIdAndDate
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockNotificationModel = jest.fn();
mockNotificationModel.find = jest.fn();
mockNotificationModel.findById = jest.fn();
mockNotificationModel.findOne = jest.fn();
mockNotificationModel.findByIdAndUpdate = jest.fn();
mockNotificationModel.findByIdAndRemove = jest.fn();
mockNotificationModel.findOneAndUpdate = jest.fn();
mockNotificationModel.deleteOne = jest.fn();

const mockModel = {
  Notification: mockNotificationModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Notification;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Notification: mockNotificationModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Notification = await import('../../../model/notification.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Notification Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationModel.mockClear();
    mockNotificationModel.find.mockClear();
    mockNotificationModel.findById.mockClear();
    mockNotificationModel.findOne.mockClear();
    mockNotificationModel.findByIdAndUpdate.mockClear();
    mockNotificationModel.findByIdAndRemove.mockClear();
    mockNotificationModel.findOneAndUpdate.mockClear();
    mockNotificationModel.deleteOne.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createNotification', () => {
    it('should create a new notification', async () => {
      // Arrange
      const notificationTypeId = new mongoose.Types.ObjectId();
      const notification = 'Test notification message';
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');
      const publish = true;
      const lang = 'en';

      const savedNotificationData = {
        _id: new mongoose.Types.ObjectId(),
        notificationType: notificationTypeId,
        notification: notification,
        startDate: startDate,
        endDate: endDate,
        publish: publish,
        lang: lang
      };

      const mockSavedNotification = {
        _id: savedNotificationData._id,
        notificationType: notificationTypeId,
        notification: notification,
        startDate: startDate,
        endDate: endDate,
        publish: publish,
        lang: lang,
        save: jest.fn().mockResolvedValue(savedNotificationData)
      };

      mockNotificationModel.mockImplementation(() => mockSavedNotification);

      // Act
      const result = await Notification.createNotification(
        notificationTypeId,
        notification,
        startDate,
        endDate,
        publish,
        lang
      );

      // Assert
      expect(mockNotificationModel).toHaveBeenCalled();
      expect(mockSavedNotification.save).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.notification).toBe(notification);
    });
  });

  describe('getAllNotification', () => {
    it('should retrieve all notifications', async () => {
      // Arrange
      const mockNotifications = [
        {
          _id: new mongoose.Types.ObjectId(),
          notification: 'Notification 1',
          startDate: new Date('2025-01-01')
        },
        {
          _id: new mongoose.Types.ObjectId(),
          notification: 'Notification 2',
          startDate: new Date('2025-01-02')
        }
      ];

      mockNotificationModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(mockNotifications)
              })
            })
          })
        })
      });

      // Act
      const result = await Notification.getAllNotification();

      // Assert
      expect(mockNotificationModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getNotificationById', () => {
    it('should retrieve notification by ID', async () => {
      // Arrange
      const notificationId = new mongoose.Types.ObjectId();
      const mockNotification = {
        _id: notificationId,
        notification: 'Test notification',
        notificationType: { name: 'Info' }
      };

      mockNotificationModel.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockNotification)
        })
      });

      // Act
      const result = await Notification.getNotificationById(notificationId);

      // Assert
      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({ '_id': notificationId });
      expect(result).toBeDefined();
      expect(result._id).toEqual(notificationId);
    });
  });

  describe('updateNotificationById', () => {
    it('should update notification successfully', async () => {
      // Arrange
      const notificationId = new mongoose.Types.ObjectId();
      const updateData = {
        notification: 'Updated notification',
        publish: false
      };

      const updatedNotification = {
        _id: notificationId,
        ...updateData
      };

      mockNotificationModel.findByIdAndUpdate = jest.fn().mockResolvedValue(updatedNotification);

      // Act
      const result = await Notification.updateNotificationById(notificationId, updateData);

      // Assert
      expect(mockNotificationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        notificationId,
        { $set: updateData },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.notification).toBe('Updated notification');
    });
  });

  describe('deleteNotificationById', () => {
    it('should delete notification successfully', async () => {
      // Arrange
      const notificationId = new mongoose.Types.ObjectId();
      const deletedNotification = {
        _id: notificationId,
        notification: 'Deleted notification'
      };

      mockNotificationModel.findByIdAndRemove = jest.fn().mockResolvedValue(deletedNotification);

      // Act
      const result = await Notification.deleteNotificationById(notificationId);

      // Assert
      expect(mockNotificationModel.findByIdAndRemove).toHaveBeenCalledWith(notificationId);
      expect(result).toBeDefined();
    });
  });

  describe('getAllNotificationForWebsite', () => {
    it('should retrieve published notifications for website', async () => {
      // Arrange
      const mockNotifications = [
        {
          _id: new mongoose.Types.ObjectId(),
          notification: 'Published notification',
          publish: true,
          startDate: new Date()
        }
      ];

      mockNotificationModel.find.mockReturnValue({
        where: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(mockNotifications)
            })
          })
        })
      });

      // Act
      const result = await Notification.getAllNotificationForWebsite();

      // Assert
      expect(mockNotificationModel.find).toHaveBeenCalledWith({ 'publish': true });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getNotificationByIdAndDate', () => {
    it('should retrieve notification by ID and date range', async () => {
      // Arrange
      const notification = 'Test notification';
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');
      const mockNotification = {
        _id: new mongoose.Types.ObjectId(),
        notification: notification,
        startDate: startDate,
        endDate: endDate
      };

      mockNotificationModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockNotification)
      });

      // Act
      const result = await Notification.getNotificationByIdAndDate(notification, startDate, endDate);

      // Assert
      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({
        'notification': notification,
        'startDate': startDate,
        'endDate': endDate
      });
      expect(result).toBeDefined();
    });
  });
});

