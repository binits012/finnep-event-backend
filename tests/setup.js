import { jest } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

let mongoServer;

// Setup before all tests
beforeAll(async () => {
  try {
    // Create in-memory MongoDB instance for testing
    mongoServer = await MongoMemoryServer.create({
      instance: {
        dbName: 'finnep_eventapp_test'
      }
    });

    const mongoUri = mongoServer.getUri();

    // Set test environment variables
    process.env.MONGODB_HOST = mongoUri;
    process.env.NODE_ENV = 'test';
    process.env.JWT_TOKEN_SECRET = process.env.JWT_TOKEN_SECRET || 'test-secret-key-minimum-32-characters-long';
    process.env.TOKEN_LIFE_SPAN = '1h';
    process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET || 'test-guest-secret-key-minimum-32-characters';
    process.env.GUEST_TOKEN_EXPIRES_IN = '15m';

    // Mock Redis for tests (unless integration test)
    if (!process.env.USE_REAL_REDIS) {
      // Redis will be mocked in individual tests
    }

    // Mock RabbitMQ for tests (unless integration test)
    if (!process.env.USE_REAL_RABBITMQ) {
      // RabbitMQ will be mocked in individual tests
    }

    console.log('Test environment setup complete');
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
});

// Cleanup after all tests
afterAll(async () => {
  try {
    if (mongoServer) {
      await mongoServer.stop();
      console.log('MongoDB Memory Server stopped');
    }
  } catch (error) {
    console.error('Error during test cleanup:', error);
  }
});

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(10000);

