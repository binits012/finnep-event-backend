import { InboxMessage } from './mongoModel.js';

export class InboxModel {

  async saveMessage({ messageId, eventType, aggregateId, data, metadata }) {
    const doc = new InboxMessage({
        messageId,
        eventType,
        aggregateId,
        data,
        metadata,
        receivedAt: new Date(),
        processed: false,
        retryCount: 0
      });
      await doc.save(); 
  }

  async markProcessed(messageId) {
    await InboxMessage.updateOne(
      { messageId },
      {
        $set: {
          processed: true,
          processedAt: new Date(),
          errorInfo: null
        }
      }
    );
  }

  async markFailed(messageId, error, retryCount) {
    await InboxMessage.updateOne(
      { messageId },
      {
        $set: {
          processed: false,
          errorInfo: error,
          retryCount,
          lastAttemptAt: new Date()
        }
      }
    );
  }

  async isProcessed(messageId) {
    const result = await InboxMessage.findOne({ messageId, processed: true }).lean();
    return !!result;
  }
}

export const inboxModel = new InboxModel();