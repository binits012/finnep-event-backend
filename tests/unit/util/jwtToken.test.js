/**
 * JWT Token Utilities Unit Tests
 *
 * Tests for:
 * - generateJWT
 * - verifyJWT
 * - generateGuestJWT
 * - verifyGuestJWT
 * - invalidateJWT
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies before importing
const mockToken = {
  createToken: jest.fn(),
  removeTokenByUserId: jest.fn()
};

const mockCommonUtil = {
  setCacheByKey: jest.fn(),
  getCacheByKey: jest.fn(),
  removeCacheByKey: jest.fn()
};

const mockRedisClient = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1)
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn()
};

// Use dynamic imports for ES modules
let jwtToken;

beforeAll(async () => {
  // Use absolute paths for mocking
  const tokenPath = resolve(__dirname, '../../../model/token.js');
  const commonPath = resolve(__dirname, '../../../util/common.js');
  const redisPath = resolve(__dirname, '../../../model/redisConnect.js');
  const jwtPath = resolve(__dirname, '../../../node_modules/jsonwebtoken');

  // Mock modules using jest.unstable_mockModule for ES modules
  jest.unstable_mockModule(tokenPath, () => ({
    default: mockToken,
    createToken: mockToken.createToken,
    removeTokenByUserId: mockToken.removeTokenByUserId
  }));

  jest.unstable_mockModule(commonPath, () => ({
    default: mockCommonUtil,
    setCacheByKey: mockCommonUtil.setCacheByKey,
    getCacheByKey: mockCommonUtil.getCacheByKey,
    removeCacheByKey: mockCommonUtil.removeCacheByKey
  }));

  jest.unstable_mockModule(redisPath, () => ({
    default: mockRedisClient
  }));

  jest.unstable_mockModule('jsonwebtoken', () => ({
    default: mockJwt,
    sign: mockJwt.sign,
    verify: mockJwt.verify
  }));

  // Set environment variables
  process.env.JWT_TOKEN_SECRET = process.env.JWT_TOKEN_SECRET || 'test-secret-key-minimum-32-characters-long';
  process.env.TOKEN_LIFE_SPAN = process.env.TOKEN_LIFE_SPAN || '1h';
  process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET || 'test-guest-secret-key-minimum-32-characters';

  // Now import the modules
  jwtToken = await import('../../../util/jwtToken.js');
});

describe('JWT Token Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks
    mockToken.createToken.mockClear();
    mockToken.removeTokenByUserId.mockClear();
    mockCommonUtil.setCacheByKey.mockClear();
    mockCommonUtil.getCacheByKey.mockClear();
    mockCommonUtil.removeCacheByKey.mockClear();
    mockRedisClient.get.mockClear();
    mockRedisClient.set.mockClear();
    mockRedisClient.del.mockClear();
    mockRedisClient.expire.mockClear();
    mockJwt.sign.mockClear();
    mockJwt.verify.mockClear();
  });

  describe('generateJWT', () => {
    it('should generate a valid JWT token', (done) => {
      const userData = {
        id: '507f1f77bcf86cd799439011',
        username: 'test@example.com',
        role: 'admin'
      };

      const mockTokenString = 'mock.jwt.token';

      // Mock JWT sign
      mockJwt.sign.mockImplementation((payload, secret, options, callback) => {
        callback(null, mockTokenString);
      });

      // Mock token creation
      mockToken.createToken.mockResolvedValue({
        token: mockTokenString,
        userId: userData.id
      });

      mockCommonUtil.setCacheByKey.mockResolvedValue(true);

      jwtToken.generateJWT(userData, (error, token) => {
        expect(error).toBeNull();
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(mockJwt.sign).toHaveBeenCalled();
        expect(mockToken.createToken).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors during token generation', (done) => {
      const userData = {
        id: '507f1f77bcf86cd799439011',
        username: 'test@example.com',
        role: 'admin'
      };

      // Mock JWT sign error
      mockJwt.sign.mockImplementation((payload, secret, options, callback) => {
        callback(new Error('JWT sign failed'), null);
      });

      jwtToken.generateJWT(userData, (error, token) => {
        expect(error).toBeDefined();
        expect(token).toBeNull();
        done();
      });
    });

    it('should handle database errors during token creation', (done) => {
      const userData = {
        id: '507f1f77bcf86cd799439011',
        username: 'test@example.com',
        role: 'admin'
      };

      const mockTokenString = 'mock.jwt.token';

      // Mock JWT sign success
      mockJwt.sign.mockImplementation((payload, secret, options, callback) => {
        callback(null, mockTokenString);
      });

      // Mock token creation failure
      mockToken.createToken.mockRejectedValue(new Error('Database error'));

      jwtToken.generateJWT(userData, (error, token) => {
        expect(error).toBeDefined();
        expect(token).toBeNull();
        done();
      });
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', (done) => {
      const testToken = 'Bearer valid.jwt.token';
      const myToken = 'valid.jwt.token';
      const mockUserData = {
        id: '507f1f77bcf86cd799439011',
        username: 'test@example.com',
        role: 'admin'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockUserData);
      });

      // Mock Redis cache
      mockCommonUtil.getCacheByKey.mockResolvedValue({
        token: myToken,
        userId: mockUserData.id,
        isValid: true
      });

      jwtToken.verifyJWT(testToken, (error, data) => {
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(mockJwt.verify).toHaveBeenCalled();
        expect(mockCommonUtil.getCacheByKey).toHaveBeenCalled();
        done();
      });
    });

    it('should reject invalid token', (done) => {
      const invalidToken = 'Bearer invalid.token.here';

      // Mock JWT verify error
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(new Error('Invalid token'), null);
      });

      jwtToken.verifyJWT(invalidToken, (error, data) => {
        expect(error).toBeDefined();
        expect(data).toBeNull();
        done();
      });
    });

    it('should reject null or undefined token', (done) => {
      jwtToken.verifyJWT(null, (error, data) => {
        expect(data).toBeNull();
        expect(error).toBeNull();
        done();
      });
    });

    it('should reject guest tokens', (done) => {
      const guestToken = 'Bearer guest.token';
      const myToken = 'guest.token';
      const mockGuestData = {
        id: 'guest@example.com',
        role: 'guest',
        type: 'guest_access'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockGuestData);
      });

      jwtToken.verifyJWT(`Bearer ${myToken}`, (error, data) => {
        expect(error).toBeDefined();
        expect(error.message).toContain('Guest tokens not allowed');
        expect(data).toBeNull();
        done();
      });
    });

    it('should reject token when cache data is null', (done) => {
      const testToken = 'Bearer valid.jwt.token';
      const mockUserData = {
        id: '507f1f77bcf86cd799439011',
        username: 'test@example.com',
        role: 'admin'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockUserData);
      });

      // Mock Redis cache returning null
      mockCommonUtil.getCacheByKey.mockResolvedValue(null);

      jwtToken.verifyJWT(testToken, (error, data) => {
        expect(data).toBeNull();
        done();
      });
    });
  });

  describe('generateGuestJWT', () => {
    it('should generate a guest JWT token', (done) => {
      const email = 'guest@example.com';
      const emailCryptoId = '507f1f77bcf86cd799439011';
      const mockTokenString = 'guest.jwt.token';

      // Mock JWT sign
      mockJwt.sign.mockImplementation((payload, secret, options, callback) => {
        callback(null, mockTokenString);
      });

      mockCommonUtil.setCacheByKey.mockResolvedValue(true);
      mockRedisClient.expire.mockResolvedValue(1);

      jwtToken.generateGuestJWT(email, emailCryptoId, (error, token) => {
        expect(error).toBeNull();
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(mockJwt.sign).toHaveBeenCalled();
        expect(mockCommonUtil.setCacheByKey).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors during guest token generation', (done) => {
      const email = 'guest@example.com';
      const emailCryptoId = '507f1f77bcf86cd799439011';

      // Mock JWT sign error
      mockJwt.sign.mockImplementation((payload, secret, options, callback) => {
        callback(new Error('JWT sign failed'), null);
      });

      jwtToken.generateGuestJWT(email, emailCryptoId, (error, token) => {
        expect(error).toBeDefined();
        expect(token).toBeNull();
        done();
      });
    });
  });

  describe('verifyGuestJWT', () => {
    it('should verify a valid guest token', (done) => {
      const guestToken = 'Bearer guest.jwt.token';
      const myToken = 'guest.jwt.token';
      const emailCryptoId = '507f1f77bcf86cd799439011';
      const mockGuestData = {
        email: 'guest@example.com',
        emailCryptoId: emailCryptoId,
        role: 'guest',
        type: 'guest_access'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockGuestData);
      });

      // Mock Redis cache
      mockCommonUtil.getCacheByKey.mockResolvedValue({
        token: myToken,
        isValid: true
      });

      jwtToken.verifyGuestJWT(guestToken, (error, data) => {
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.role).toBe('guest');
        done();
      });
    });

    it('should reject non-guest tokens', (done) => {
      const token = 'Bearer regular.jwt.token';
      const mockUserData = {
        id: '507f1f77bcf86cd799439011',
        role: 'admin'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockUserData);
      });

      jwtToken.verifyGuestJWT(token, (error, data) => {
        expect(error).toBeDefined();
        expect(error.message).toContain('Invalid token type');
        expect(data).toBeNull();
        done();
      });
    });
  });

  describe('invalidateJWT', () => {
    it('should invalidate a JWT token', (done) => {
      const token = 'Bearer token.to.invalidate';
      const myToken = 'token.to.invalidate';
      const userId = '507f1f77bcf86cd799439011';
      const mockUserData = {
        id: userId,
        username: 'test@example.com'
      };

      // Mock JWT verify
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(null, mockUserData);
      });

      // Mock Redis deletion
      mockCommonUtil.removeCacheByKey.mockResolvedValue(true);
      mockToken.removeTokenByUserId.mockResolvedValue(true);

      jwtToken.invalidateJWT(token, (error, result) => {
        expect(error).toBeNull();
        expect(mockCommonUtil.removeCacheByKey).toHaveBeenCalled();
        expect(mockToken.removeTokenByUserId).toHaveBeenCalled();
        done();
      });
    });

    it('should handle errors during token invalidation', (done) => {
      const token = 'Bearer invalid.token';

      // Mock JWT verify error - when error occurs, data is null
      mockJwt.verify.mockImplementation((token, secret, callback) => {
        callback(new Error('Invalid token'), null);
      });

      jwtToken.invalidateJWT(token, (error, result) => {
        // Error should be passed to callback
        expect(error).toBeDefined();
        expect(result).toBeNull();
        done();
      });
    });
  });
});

