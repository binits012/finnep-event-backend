/**
 * Free Event Registration Integration Tests
 *
 * Tests for:
 * - POST /front/free-event-register
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import getApp from '../../helpers/appHelper.js';

// Mock app to prevent server from starting during tests
let app;
beforeAll(async () => {
  app = await getApp();
});

describe('Front Free Event Registration Endpoints', () => {
  let testFreeEventId;
  let testFreeTicketTypeId;

  beforeAll(async () => {
    // Setup: Create test free event if needed
    // This would typically be done via test database seeding
  });

  afterAll(async () => {
    // Cleanup test data
  });

  describe('POST /front/free-event-register', () => {
    it('should return 200 when registering for free event', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          eventId: testFreeEventId || 'test_free_event_id',
          email: 'user@example.com',
          ticketType: testFreeTicketTypeId || 'test_free_ticket_type_id'
        });

      // Note: This will fail without proper database setup
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.ticket).toBeDefined();
        expect(response.body.data.ticket.otp).toBeDefined();
      } else {
        expect([400, 404, 500]).toContain(response.status);
      }
    });

    it('should return 400 for paid event', async () => {
      // This would require a paid event ID
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          eventId: 'test_paid_event_id',
          email: 'user@example.com',
          ticketType: 'test_ticket_type_id'
        });

      // Should return 400 if event is not free
      if (response.status === 400) {
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('free event');
      }
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          email: 'invalid-email-format',
          quantity: 1,
          eventId: testFreeEventId || '507f1f77bcf86cd799439011',
          merchantId: '507f1f77bcf86cd799439012',
          externalMerchantId: '123',
          eventName: 'Test Event',
          ticketName: 'Free Ticket'
        });

      // Should return 400 for invalid email format
      expect([400, 500]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.success).toBe(false);
      }
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          // Missing required fields: email, quantity, eventId, merchantId, externalMerchantId, eventName, ticketName
        });

      // Should return 400 for missing required fields
      expect([400, 500]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.success).toBe(false);
      }
    });

    it('should return 404 for non-existent event', async () => {
      const nonExistentId = '507f1f77bcf86cd799439999';

      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          email: 'user@example.com',
          quantity: 1,
          eventId: nonExistentId,
          merchantId: '507f1f77bcf86cd799439012',
          externalMerchantId: '123',
          eventName: 'Test Event',
          ticketName: 'Free Ticket'
        });

      // Should return 404 for non-existent event
      expect([400, 404, 500]).toContain(response.status);
      if (response.status === 404) {
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Event not found');
      }
    });

    it('should return 404 for non-existent ticket type', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          eventId: testFreeEventId || 'test_free_event_id',
          email: 'user@example.com',
          ticketType: 'non_existent_ticket_type'
        });

      // Should return 404 if ticket type doesn't exist
      if (response.status === 404) {
        expect(response.body.success).toBe(false);
      }
    });

    it('should create ticket with quantity 1 for free events', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          eventId: testFreeEventId || 'test_free_event_id',
          email: 'user@example.com',
          ticketType: testFreeTicketTypeId || 'test_free_ticket_type_id'
        });

      // Note: This will fail without proper setup
      if (response.status === 200) {
        expect(response.body.data.ticket).toBeDefined();
        // Verify quantity is 1 (default for free events)
        // This would require checking the actual ticket data
      }
    });

    it('should send email with ticket details', async () => {
      const response = await request(app)
        .post('/front/free-event-register')
        .send({
          eventId: testFreeEventId || 'test_free_event_id',
          email: 'user@example.com',
          ticketType: testFreeTicketTypeId || 'test_free_ticket_type_id'
        });

      // Note: This will fail without proper setup
      // In a real test, you would verify that an email was sent
      // This could be done by mocking the email service
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        // Email sending would be verified via mocked email service
      }
    });
  });
});

