/**
 * AWS S3/CloudFront Mock
 * Mock AWS services for testing
 */

import { jest } from '@jest/globals';

export const createAwsMock = () => {
  const mockS3 = {
    send: jest.fn().mockResolvedValue({
      Location: 'https://s3.amazonaws.com/bucket/file.jpg',
      ETag: '"mock-etag"'
    }),
    putObject: jest.fn().mockReturnThis(),
    getObject: jest.fn().mockReturnThis(),
    deleteObject: jest.fn().mockReturnThis()
  };

  const mockCloudFront = {
    getSignedUrl: jest.fn().mockReturnValue('https://cloudfront.net/signed-url?signature=mock')
  };

  return {
    s3: mockS3,
    cloudFront: mockCloudFront
  };
};

export default createAwsMock;

