/**
 * AWS Utilities Unit Tests
 *
 * Tests for:
 * - uploadToS3Bucket
 * - streamBasedParallelUpload
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockS3Client = {
  send: jest.fn()
};

const mockUpload = jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  done: jest.fn().mockResolvedValue({})
}));

const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

// Use dynamic imports for ES modules
let aws;

beforeAll(async () => {
  // Use absolute paths for mocking
  const loggerPath = resolve(__dirname, '../../../model/logger.js');

  jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => mockS3Client),
    PutObjectCommand: jest.fn()
  }));

  jest.unstable_mockModule('@aws-sdk/lib-storage', () => ({
    Upload: mockUpload
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error,
    info: mockLogger.info
  }));

  // Set environment variables
  process.env.BUCKET_NAME = process.env.BUCKET_NAME || 'test-bucket';
  process.env.BUCKET_REGION = process.env.BUCKET_REGION || 'us-east-1';
  process.env.BUCKET_ACCESS_CLIENT = process.env.BUCKET_ACCESS_CLIENT || 'test-access-key';
  process.env.BUCKET_ACCESS_KEY = process.env.BUCKET_ACCESS_KEY || 'test-secret-key';

  aws = await import('../../../util/aws.js');
});

describe('AWS Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Client.send.mockClear();
    mockUpload.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
  });

  describe('uploadToS3Bucket', () => {
    it('should upload file to S3 successfully', async () => {
      // Arrange
      const fileType = 'image/jpeg';
      const fileContent = Buffer.from('test file content');
      const pathToS3 = 'test/path/image.jpg';

      mockS3Client.send.mockResolvedValue({
        ETag: '"mock-etag"',
        Location: 'https://s3.amazonaws.com/bucket/test/path/image.jpg'
      });

      // Act
      await aws.uploadToS3Bucket(fileType, fileContent, pathToS3);

      // Assert
      expect(mockS3Client.send).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle upload errors gracefully', async () => {
      // Arrange
      const fileType = 'image/jpeg';
      const fileContent = Buffer.from('test file content');
      const pathToS3 = 'test/path/image.jpg';

      const mockError = new Error('S3 upload failed');
      mockS3Client.send.mockRejectedValue(mockError);

      // Act
      await aws.uploadToS3Bucket(fileType, fileContent, pathToS3);

      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('streamBasedParallelUpload', () => {
    it('should upload stream to S3 successfully', async () => {
      // Arrange
      const fileType = 'image/jpeg';
      const key = 'test/path/image.jpg';
      const streamObj = {
        pipe: jest.fn(),
        on: jest.fn()
      };

      const mockUploadInstance = {
        on: jest.fn(),
        done: jest.fn().mockResolvedValue({})
      };

      mockUpload.mockReturnValue(mockUploadInstance);

      // Act
      await aws.streamBasedParallelUpload(fileType, key, streamObj);

      // Assert
      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Key: key,
            ContentType: fileType
          })
        })
      );
      expect(mockUploadInstance.done).toHaveBeenCalled();
    });

    it('should handle upload progress events', async () => {
      // Arrange
      const fileType = 'image/jpeg';
      const key = 'test/path/image.jpg';
      const streamObj = {
        pipe: jest.fn(),
        on: jest.fn()
      };

      const mockUploadInstance = {
        on: jest.fn((event, callback) => {
          if (event === 'httpUploadProgress') {
            // Simulate progress callback
            callback({ loaded: 50, total: 100 });
          }
        }),
        done: jest.fn().mockResolvedValue({})
      };

      mockUpload.mockReturnValue(mockUploadInstance);

      // Act
      await aws.streamBasedParallelUpload(fileType, key, streamObj);

      // Assert
      expect(mockUploadInstance.on).toHaveBeenCalledWith(
        'httpUploadProgress',
        expect.any(Function)
      );
    });
  });
});

