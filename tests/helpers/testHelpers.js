/**
 * Test Helper Utilities
 * Common functions for test setup and data generation
 */

import { jest } from '@jest/globals';

/**
 * Create a mock Express request object
 */
export const createMockRequest = (overrides = {}) => {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: null,
    ...overrides
  };
};

/**
 * Create a mock Express response object
 */
export const createMockResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    locals: {}
  };
  return res;
};

/**
 * Create a mock Express next function
 */
export const createMockNext = () => {
  return jest.fn();
};

/**
 * Create a mock user object
 */
export const createMockUser = (overrides = {}) => {
  return {
    id: '507f1f77bcf86cd799439011',
    username: 'test@example.com',
    email: 'test@example.com',
    role: 'admin',
    ...overrides
  };
};

/**
 * Create a mock event object
 */
export const createMockEvent = (overrides = {}) => {
  return {
    _id: '507f1f77bcf86cd799439012',
    eventTitle: 'Test Event',
    eventDescription: 'Test Description',
    eventDate: new Date('2025-12-31T18:00:00Z'),
    occupancy: 100,
    active: true,
    status: 'up-coming',
    merchant: '507f1f77bcf86cd799439013',
    ...overrides
  };
};

/**
 * Create a mock ticket object
 */
export const createMockTicket = (overrides = {}) => {
  return {
    _id: '507f1f77bcf86cd799439014',
    event: '507f1f77bcf86cd799439012',
    ticketFor: '507f1f77bcf86cd799439011',
    ticketInfo: new Map([
      ['ticketName', 'General Admission'],
      ['price', 50],
      ['quantity', 2]
    ]),
    ...overrides
  };
};

/**
 * Wait for async operations
 */
export const waitFor = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create a mock JWT token
 */
export const createMockJWT = (payload = {}) => {
  // This is a simplified mock - in real tests, use actual JWT generation
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `mock.${base64Payload}.signature`;
};

