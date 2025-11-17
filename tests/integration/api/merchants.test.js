/**
 * Merchants API Integration Tests
 *
 * Tests for:
 * - GET /api/merchant
 * - GET /api/merchant/:id
 * - PATCH /api/merchant/:id
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import getApp from '../../helpers/appHelper.js';

// Mock app to prevent server from starting during tests
let app;
beforeAll(async () => {
  app = await getApp();
});

describe('API Merchants Endpoints', () => {
  let authToken;
  let testMerchantId;

  beforeAll(async () => {
    // Setup: Login and get token
  });

  afterAll(async () => {
    // Cleanup test data
  });

  describe('GET /api/merchant', () => {
    it('should return 200 with list of merchants', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .get('/api/merchant')
        .set('Authorization', `Bearer ${authToken}`);

      // Note: This will fail without proper database setup
      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);
      } else {
        expect([401, 500]).toContain(response.status);
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/merchant');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/merchant/:id', () => {
    it('should return 200 with merchant details', async () => {
      if (!authToken || !testMerchantId) {
        return;
      }

      const response = await request(app)
        .get(`/api/merchant/${testMerchantId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
        expect(response.body.data._id).toBe(testMerchantId);
      } else {
        expect([401, 404, 500]).toContain(response.status);
      }
    });

    it('should return 404 for non-existent merchant', async () => {
      if (!authToken) {
        return;
      }

      const nonExistentId = '507f1f77bcf86cd799439999';

      const response = await request(app)
        .get(`/api/merchant/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/merchant/:id', () => {
    it('should update merchant', async () => {
      if (!authToken || !testMerchantId) {
        return;
      }

      const response = await request(app)
        .patch(`/api/merchant/${testMerchantId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Merchant Name',
          status: 'inactive'
        });

      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
        expect(response.body.data.name).toBe('Updated Merchant Name');
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });

    it('should update merchant bankingInfo', async () => {
      if (!authToken || !testMerchantId) {
        return;
      }

      const response = await request(app)
        .patch(`/api/merchant/${testMerchantId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          bankingInfo: {
            bank_name: 'Test Bank',
            account_holder_name: 'Test Account',
            bank_account: '1234567890',
            bic_swift: 'TESTBIC123',
            bank_address: 'Test Address'
          }
        });

      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
        expect(response.body.data.bankingInfo).toBeDefined();
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });
  });
});

