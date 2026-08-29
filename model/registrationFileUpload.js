import mongoose from 'mongoose';

const registrationFileUploadSchema = new mongoose.Schema(
  {
    uploadId: { type: String, required: true, unique: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    externalMerchantId: { type: String, required: true, index: true },
    fieldId: { type: String, required: true },
    s3Key: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'reserved', 'attached', 'expired'],
      default: 'pending',
      index: true,
    },
    reservedAt: { type: Date, default: null },
    attachedTicketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

registrationFileUploadSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: { $in: ['pending', 'reserved'] } } }
);

export const RegistrationFileUpload = mongoose.model(
  'RegistrationFileUpload',
  registrationFileUploadSchema
);
