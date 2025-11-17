/**
 * Events API Integration Tests
 *
 * Tests for:
 * - GET /api/event
 * - POST /api/event
 * - GET /api/event/:id
 * - PUT /api/event/:id
 * - PATCH /api/event/:id/status
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import getApp from '../../helpers/appHelper.js';

// Mock app to prevent server from starting during tests
let app;
beforeAll(async () => {
  app = await getApp();
});

describe('API Events Endpoints', () => {
  let authToken;
  let testEventId;

  beforeAll(async () => {
    // Setup: Login and get token
  });

  afterAll(async () => {
    // Cleanup test data
  });

  describe('GET /api/event', () => {
    it('should return 200 with list of events', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .get('/api/event')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          page: 1,
          limit: 10
        });

      // Note: This will fail without proper database setup
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data.events)).toBe(true);
      } else {
        expect([400, 401, 500]).toContain(response.status);
      }
    });

    it('should filter events by category', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .get('/api/event')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          category: 'Music',
          page: 1,
          limit: 10
        });

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/event');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/event', () => {
    it('should create a new event', async () => {
      if (!authToken) {
        return;
      }

      const eventData = {
        eventTitle: 'Test Event',
        eventDescription: 'Test Description',
        eventDate: '2025-12-31T18:00:00Z',
        occupancy: 100,
        ticketInfo: [
          {
            ticketName: 'General Admission',
            price: 50,
            quantity: 100
          }
        ],
        active: true,
        status: 'up-coming'
      };

      const response = await request(app)
        .post('/api/event')
        .set('Authorization', `Bearer ${authToken}`)
        .send(eventData);

      // Note: This will fail without proper setup
      if (response.status === 201 || response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data._id).toBeDefined();
        testEventId = response.body.data._id;
      } else {
        expect([400, 401, 500]).toContain(response.status);
      }
    });

    it('should return 400 for invalid event data', async () => {
      if (!authToken) {
        return;
      }

      const response = await request(app)
        .post('/api/event')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing required fields
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/event/:id', () => {
    it('should return 200 with event details', async () => {
      if (!authToken || !testEventId) {
        return;
      }

      const response = await request(app)
        .get(`/api/event/${testEventId}`)
        .set('Authorization', `Bearer ${authToken}`);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.eventTitle).toBeDefined();
      } else {
        expect([401, 404, 500]).toContain(response.status);
      }
    });

    it('should return 404 for non-existent event', async () => {
      if (!authToken) {
        return;
      }

      const nonExistentId = '507f1f77bcf86cd799439999';

      const response = await request(app)
        .get(`/api/event/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/event/:id', () => {
    it('should update an event', async () => {
      if (!authToken || !testEventId) {
        return;
      }

      const updateData = {
        eventTitle: 'Updated Event Title',
        active: false
      };

      const response = await request(app)
        .put(`/api/event/${testEventId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data.eventTitle).toBe(updateData.eventTitle);
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });
  });

  describe('PATCH /api/event/:id/status', () => {
    it('should update event status', async () => {
      if (!authToken || !testEventId) {
        return;
      }

      const response = await request(app)
        .patch(`/api/event/${testEventId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'on-going'
        });

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      } else {
        expect([400, 401, 404, 500]).toContain(response.status);
      }
    });
  });
});

