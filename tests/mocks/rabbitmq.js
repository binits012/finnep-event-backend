/**
 * RabbitMQ Mock
 * Mock RabbitMQ for testing
 */

import { jest } from '@jest/globals';

export const createRabbitMQMock = () => {
  const mockChannel = {
    assertQueue: jest.fn().mockResolvedValue({ queue: 'test-queue' }),
    assertExchange: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
    publish: jest.fn().mockReturnValue(true),
    sendToQueue: jest.fn().mockReturnValue(true),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'test-tag' }),
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue({}),
    connection: {
      closed: false
    }
  };

  const mockConnection = {
    createChannel: jest.fn().mockResolvedValue(mockChannel),
    close: jest.fn().mockResolvedValue({}),
    closed: false
  };

  const mockRabbitMQ = {
    connect: jest.fn().mockResolvedValue(mockConnection),
    createChannel: jest.fn().mockResolvedValue(mockChannel),
    publishChannel: mockChannel,
    consumeChannel: mockChannel,
    connection: mockConnection
  };

  return mockRabbitMQ;
};

export default createRabbitMQMock;

