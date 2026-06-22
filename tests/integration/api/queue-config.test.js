/**
 * Queue Config Integration Tests
 *
 * Tests for internal queue-service configuration endpoints:
 * - GET /api/queue/config/metrics
 * - GET /api/queue/config/email
 *
 * Uses a lightweight Express app (no Redis/Mongo/RabbitMQ) for reliable CI.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import * as queueConfig from '../../../controllers/queueConfig.controller.js';
import { authenticateInternalApiKey } from '../../../middleware/internalApiKey.middleware.js';

const INTERNAL_API_KEY = 'internal-queue-service-key';

let app;

beforeAll(() => {
  process.env.INTERNAL_API_KEY = INTERNAL_API_KEY;

  app = express();
  app.use(express.json());

  const router = express.Router();
  router.get('/queue/config/metrics', authenticateInternalApiKey, queueConfig.getQueueMetrics);
  router.get('/queue/config/email', authenticateInternalApiKey, queueConfig.getQueueEmailConfig);
  app.use('/api', router);
});

describe('Queue Config Endpoints (internal)', () => {
  describe('GET /api/queue/config/metrics', () => {
    it('should return 401 without API key', async () => {
      const response = await request(app).get('/api/queue/config/metrics');
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 401 with invalid API key', async () => {
      const response = await request(app)
        .get('/api/queue/config/metrics')
        .set('X-API-Key', 'wrong-key');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 200 with system metrics for valid API key', async () => {
      const response = await request(app)
        .get('/api/queue/config/metrics')
        .set('X-API-Key', INTERNAL_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.metrics).toBeDefined();
      expect(typeof response.body.metrics.cpu).toBe('number');
      expect(typeof response.body.metrics.memory).toBe('number');
      expect(Array.isArray(response.body.metrics.loadAverage)).toBe(true);
      expect(response.body.metrics.timestamp).toBeDefined();
    });
  });

  describe('GET /api/queue/config/email', () => {
    it('should return 401 without API key', async () => {
      const response = await request(app).get('/api/queue/config/email');
      expect(response.status).toBe(401);
    });

    it('should return 200 with email config for valid API key', async () => {
      const response = await request(app)
        .get('/api/queue/config/email')
        .set('X-API-Key', INTERNAL_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.emailConfig).toBeDefined();
      expect(typeof response.body.emailConfig.sendMail).toBe('boolean');
      expect(typeof response.body.emailConfig.port).toBe('number');
      expect(response.body.emailConfig.auth).toBeDefined();
    });
  });
});
