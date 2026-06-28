import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mockEventModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn()
};

const mockModel = { Event: mockEventModel };

let Event;

beforeAll(async () => {
    const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
    jest.unstable_mockModule(mongoModelPath, () => ({
        default: mockModel,
        Event: mockEventModel
    }));
    Event = await import('../../../model/event.js');
});

describe('incrementTicketTypeAvailable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('increments available and reactivates sold_out ticket type', async () => {
        const ticketTypeId = new mongoose.Types.ObjectId().toString();
        mockEventModel.findOneAndUpdate.mockResolvedValue({
            ticketInfo: [{ _id: ticketTypeId, available: 2, status: 'sold_out' }]
        });
        mockEventModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

        const result = await Event.incrementTicketTypeAvailable('event_1', ticketTypeId, 2, { available: 0 });

        expect(result.success).toBe(true);
        expect(mockEventModel.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'event_1' }),
            { $inc: { 'ticketInfo.$.available': 2 } },
            { new: true }
        );
        expect(mockEventModel.updateOne).toHaveBeenCalled();
    });

    it('returns invalid_args for bad quantity', async () => {
        const result = await Event.incrementTicketTypeAvailable('event_1', 'tt_1', 0);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_args');
    });
});
