/**
 * Queue Config Controller Unit Tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getQueueMetrics, getQueueEmailConfig } from '../../../controllers/queueConfig.controller.js';

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Queue Config Controller', () => {
  beforeEach(() => {
    process.env.EMAIL_SERVER = 'smtp.test.com';
    process.env.EMAIL_PORT = '587';
    process.env.EMAIL_USERNAME = 'alerts@test.com';
    process.env.EMAIL_PASSWORD = 'secret';
    process.env.EMAIL_SEND_MAIL = 'true';
  });

  describe('getQueueMetrics', () => {
    it('should return metrics with expected shape', async () => {
      const req = {};
      const res = createMockRes();

      await getQueueMetrics(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.metrics).toMatchObject({
        cpu: expect.any(Number),
        memory: expect.any(Number),
        responseTime: 0,
        errorRate: 0,
        connections: 0
      });
      expect(Array.isArray(payload.metrics.loadAverage)).toBe(true);
    });
  });

  describe('getQueueEmailConfig', () => {
    it('should return email config from environment', async () => {
      const req = {};
      const res = createMockRes();

      await getQueueEmailConfig(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.emailConfig.host).toBe('smtp.test.com');
      expect(payload.emailConfig.port).toBe(587);
      expect(payload.emailConfig.auth.user).toBe('alerts@test.com');
      expect(payload.emailConfig.auth.pass).toBe('secret');
    });
  });
});
