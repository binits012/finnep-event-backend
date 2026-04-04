import mongoose from 'mongoose';

const personalDataRequestSchema = new mongoose.Schema(
	{
		requestId: { type: String, required: true, unique: true, index: true },
		status: { type: String, required: true, default: 'received', index: true },

		requester: {
			firstName: { type: String, default: '' },
			lastName: { type: String, default: '' },
			email: { type: String, required: true, index: true },
			phone: { type: String, default: '' },
			address: { type: String, default: '' }
		},

		requestType: {
			type: String,
			required: true,
			enum: ['access', 'deletion', 'correction', 'other']
		},

		message: { type: String, required: true },
		consent: { type: Boolean, required: true },

		processedAt: { type: Date, default: null },
		processedNote: { type: String, default: '' }
	},
	{
		timestamps: true
	}
);

personalDataRequestSchema.index({ 'requester.email': 1, createdAt: -1 });

export const PersonalDataRequest = mongoose.model('PersonalDataRequest', personalDataRequestSchema);

