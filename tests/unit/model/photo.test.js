/**
 * Photo Model Unit Tests
 *
 * Tests for:
 * - uploadPhoto
 * - listPhoto
 * - getPhotoById
 * - updatePhotoById
 * - deletePhotoById
 * - getGalleryPhoto
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockPhotoModel = jest.fn();
mockPhotoModel.find = jest.fn();
mockPhotoModel.findById = jest.fn();
mockPhotoModel.findOne = jest.fn();
mockPhotoModel.findByIdAndUpdate = jest.fn();
mockPhotoModel.findByIdAndRemove = jest.fn();

const mockModel = {
  Photo: mockPhotoModel
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Photo;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Photo: mockPhotoModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  Photo = await import('../../../model/photo.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Photo Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhotoModel.mockClear();
    mockPhotoModel.find.mockClear();
    mockPhotoModel.findById.mockClear();
    mockPhotoModel.findOne.mockClear();
    mockPhotoModel.findByIdAndUpdate.mockClear();
    mockPhotoModel.findByIdAndRemove.mockClear();
    mockLogger.error.mockClear();
  });

  describe('uploadPhoto', () => {
    it('should upload a new photo', async () => {
      // Arrange
      const photoLink = 'https://example.com/photo.jpg';
      const publish = true;
      const position = 1;
      const photoTypeId = new mongoose.Types.ObjectId();

      const savedPhotoData = {
        _id: new mongoose.Types.ObjectId(),
        photoLink: photoLink,
        publish: publish,
        position: position,
        photoType: photoTypeId
      };

      const mockSavedPhoto = {
        _id: savedPhotoData._id,
        photoLink: photoLink,
        publish: publish,
        position: position,
        photoType: photoTypeId,
        save: jest.fn().mockResolvedValue(savedPhotoData)
      };

      mockPhotoModel.mockImplementation(() => mockSavedPhoto);

      // Act
      const result = await Photo.uploadPhoto(photoLink, publish, position, photoTypeId);

      // Assert
      expect(mockPhotoModel).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.photoLink).toBe(photoLink);
    });

    it('should handle validation errors', async () => {
      // Arrange
      const photoLink = null;
      const publish = true;
      const position = 1;
      const photoTypeId = new mongoose.Types.ObjectId();

      const mockError = new Error('Validation failed');
      const mockPhotoInstance = {
        save: jest.fn().mockRejectedValue(mockError)
      };
      mockPhotoModel.mockImplementation(() => mockPhotoInstance);

      // Act & Assert
      await expect(
        Photo.uploadPhoto(photoLink, publish, position, photoTypeId)
      ).rejects.toThrow();
    });
  });

  describe('listPhoto', () => {
    it('should retrieve all photos with photoType populated', async () => {
      // Arrange
      const mockPhotos = [
        {
          _id: new mongoose.Types.ObjectId(),
          photoLink: 'https://example.com/photo1.jpg',
          position: 1,
          photoType: { name: 'Gallery' }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          photoLink: 'https://example.com/photo2.jpg',
          position: 2,
          photoType: { name: 'Banner' }
        }
      ];

      mockPhotoModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockPhotos)
        })
      });

      // Act
      const result = await Photo.listPhoto();

      // Assert
      expect(mockPhotoModel.find).toHaveBeenCalledWith({});
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockError = new Error('Database error');
      mockPhotoModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockRejectedValue(mockError)
        })
      });

      // Act
      const result = await Photo.listPhoto();

      // Assert
      expect(result).toHaveProperty('error');
    });
  });

  describe('getPhotoById', () => {
    it('should retrieve photo by ID', async () => {
      // Arrange
      const photoId = new mongoose.Types.ObjectId();
      const mockPhoto = {
        _id: photoId,
        photoLink: 'https://example.com/photo.jpg',
        publish: true
      };

      mockPhotoModel.findOne.mockResolvedValue(mockPhoto);

      // Act
      const result = await Photo.getPhotoById(photoId);

      // Assert
      expect(mockPhotoModel.findOne).toHaveBeenCalledWith({ '_id': photoId });
      expect(result).toBeDefined();
      expect(result._id).toEqual(photoId);
    });
  });

  describe('updatePhotoById', () => {
    it('should update photo successfully', async () => {
      // Arrange
      const photoId = new mongoose.Types.ObjectId();
      const position = 5;
      const publish = false;
      const photoTypeId = new mongoose.Types.ObjectId();

      const updatedPhoto = {
        _id: photoId,
        position: position,
        publish: publish,
        photoType: photoTypeId
      };

      mockPhotoModel.findByIdAndUpdate.mockResolvedValue(updatedPhoto);

      // Act
      const result = await Photo.updatePhotoById(photoId, position, publish, photoTypeId);

      // Assert
      expect(mockPhotoModel.findByIdAndUpdate).toHaveBeenCalledWith(
        photoId,
        { $set: { position: position, publish: publish, photoType: photoTypeId } },
        { new: true }
      );
      expect(result).toBeDefined();
      expect(result.position).toBe(position);
    });
  });

  describe('deletePhotoById', () => {
    it('should delete photo successfully', async () => {
      // Arrange
      const photoId = new mongoose.Types.ObjectId();
      const deletedPhoto = {
        _id: photoId,
        photoLink: 'https://example.com/photo.jpg'
      };

      mockPhotoModel.findByIdAndRemove.mockResolvedValue(deletedPhoto);

      // Act
      const result = await Photo.deletePhotoById(photoId);

      // Assert
      expect(mockPhotoModel.findByIdAndRemove).toHaveBeenCalledWith(photoId);
      expect(result).toBeDefined();
    });
  });

  describe('getGalleryPhoto', () => {
    it('should retrieve gallery photos only', async () => {
      // Arrange
      const mockPhotos = [
        {
          _id: new mongoose.Types.ObjectId(),
          photoLink: 'https://example.com/gallery1.jpg',
          photoType: { name: 'Gallery' }
        }
      ];

      mockPhotoModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPhotos)
        })
      });

      // Act
      const result = await Photo.getGalleryPhoto();

      // Assert
      expect(mockPhotoModel.find).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

