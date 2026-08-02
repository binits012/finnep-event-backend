/**
 * Event status sync service unit tests
 */
import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mockCreateOutboxMessagesBatch = jest.fn();
const mockPublishToExchange = jest.fn();
const mockEnsureChannelsReady = jest.fn();
const mockUpdateOne = jest.fn();

let buildEventStatusOutboxMessage;
let publishEventStatusUpdates;

beforeAll(async () => {
  const outboxPath = resolve(__dirname, '../../../../model/outboxMessage.js');
  const mongoPath = resolve(__dirname, '../../../../model/mongoModel.js');
  const consumerPath = resolve(__dirname, '../../../../rabbitMQ/services/messageConsumer.js');
  const loggerPath = resolve(__dirname, '../../../../model/logger.js');

  jest.unstable_mockModule(outboxPath, () => ({
    createOutboxMessagesBatch: mockCreateOutboxMessagesBatch,
  }));

  jest.unstable_mockModule(mongoPath, () => ({
    OutboxMessage: { updateOne: mockUpdateOne },
  }));

  jest.unstable_mockModule(consumerPath, () => ({
    messageConsumer: {
      ensureChannelsReady: mockEnsureChannelsReady,
      publishToExchange: mockPublishToExchange,
    },
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }));

  const mod = await import(
    resolve(__dirname, '../../../../src/services/eventStatusSyncService.js')
  );
  buildEventStatusOutboxMessage = mod.buildEventStatusOutboxMessage;
  publishEventStatusUpdates = mod.publishEventStatusUpdates;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsureChannelsReady.mockResolvedValue(undefined);
  mockPublishToExchange.mockResolvedValue(undefined);
  mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('eventStatusSyncService', () => {
  it('builds EventDeactivated payload with completed status', () => {
    const msg = buildEventStatusOutboxMessage({
      event: {
        _id: '507f1f77bcf86cd799439011',
        externalMerchantId: '42',
        externalEventId: '99',
      },
      before: { active: true, status: 'on-going' },
      after: { active: false, status: 'completed' },
      eventType: 'EventDeactivated',
      updatedBy: 'system',
    });

    expect(msg.routingKey).toBe('external.event.status.updated');
    expect(msg.messageBody.eventType).toBe('EventDeactivated');
    expect(msg.messageBody.data.after).toEqual({
      active: false,
      status: 'completed',
    });
    expect(msg.messageBody.data.merchantId).toBe('42');
    expect(msg.messageBody.data.eventId).toBe('99');
  });

  it('writes outbox and publishes immediately', async () => {
    const message = buildEventStatusOutboxMessage({
      event: {
        _id: '507f1f77bcf86cd799439011',
        externalMerchantId: '42',
        externalEventId: '99',
      },
      before: { active: true, status: 'up-coming' },
      after: { active: false, status: 'completed' },
      eventType: 'EventDeactivated',
    });

    mockCreateOutboxMessagesBatch.mockResolvedValue([
      { _id: 'outbox-1', messageId: message.messageId },
    ]);

    const result = await publishEventStatusUpdates([message]);
    expect(mockCreateOutboxMessagesBatch).toHaveBeenCalledTimes(1);
    expect(mockPublishToExchange).toHaveBeenCalledTimes(1);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'outbox-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'sent' }),
      })
    );
    expect(result.published).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips messages without merchantId', async () => {
    const message = buildEventStatusOutboxMessage({
      event: {
        _id: '507f1f77bcf86cd799439011',
        externalEventId: '99',
      },
      before: {},
      after: { active: false, status: 'completed' },
      eventType: 'EventDeactivated',
    });

    const result = await publishEventStatusUpdates([message]);
    expect(mockCreateOutboxMessagesBatch).not.toHaveBeenCalled();
    expect(result.published).toBe(0);
  });
});
