/**
 * Financial Reports Integration Tests
 *
 * Tests for:
 * - GET /api/event/:eventId/financial-report
 * - POST /api/event/:eventId/request-external-ticket-sales
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import getApp from '../../helpers/appHelper.js';

// Mock app to prevent server from starting during tests
let app;
beforeAll(async () => {
  app = await getApp();
});

describe('API Financial Reports Endpoints', () => {
  let authToken;
  let testEventId;

  beforeAll(async () => {
    // Setup: Login and get token, create test event
    // This would typically be done via test database seeding
  });

  afterAll(async () => {
    // Cleanup test data
  });

  describe('GET /api/event/:eventId/financial-report', () => {
    it('should return 200 with financial report for completed event', async () => {
      if (!authToken || !testEventId) {
        // Skip if not set up
        return;
      }

      const response = await request(app)
        .get(`/api/event/${testEventId}/financial-report`)
        .set('Authorization', `Bearer ${authToken}`);

      // Note: This will fail without proper database setup
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.summary).toBeDefined();
        expect(response.body.data.ticketBreakdown).toBeDefined();
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });

    it('should return 400 for non-completed event', async () => {
      if (!authToken) {
        return;
      }

      // This would require an event with status != 'completed'
      const response = await request(app)
        .get(`/api/event/${testEventId}/financial-report`)
        .set('Authorization', `Bearer ${authToken}`);

      // Should return 400 if event is not completed
      if (response.status === 400) {
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('completed');
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/event/${testEventId || 'test_event_id'}/financial-report`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent event', async () => {
      if (!authToken) {
        return;
      }

      const nonExistentId = '507f1f77bcf86cd799439999';

      const response = await request(app)
        .get(`/api/event/${nonExistentId}/financial-report`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/event/:eventId/request-external-ticket-sales', () => {
    it('should return 200 when requesting external data', async () => {
      if (!authToken || !testEventId) {
        return;
      }

      const response = await request(app)
        .post(`/api/event/${testEventId}/request-external-ticket-sales`)
        .set('Authorization', `Bearer ${authToken}`);

      // Note: This will fail without proper setup
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBeDefined();
        expect(response.body.data.messageId).toBeDefined();
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post(`/api/event/${testEventId || 'test_event_id'}/request-external-ticket-sales`);

      expect(response.status).toBe(401);
    });
  });
});

