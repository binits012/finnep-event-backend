/** Private registration file uploads — metadata in Mongo, bytes in S3 (non-public prefix). */

import { randomUUID } from 'crypto';
import { RegistrationFileUpload } from '../model/registrationFileUpload.js';
import { uploadPrivateObjectToS3, deletePrivateObjectFromS3 } from './aws.js';

export const REGISTRATION_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const REGISTRATION_FILE_TTL_MS = 2 * 60 * 60 * 1000;

export const REGISTRATION_FILE_ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const REGISTRATION_FILE_EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** Resolve allowed MIME from multipart Content-Type and/or filename extension. */
export function resolveRegistrationUploadMime(mimeType, filename) {
  const raw = String(mimeType || '').trim().toLowerCase();
  if (REGISTRATION_FILE_ALLOWED_MIMES.has(raw)) return raw;

  const ext = String(filename || '').split('.').pop()?.toLowerCase();
  if (ext && REGISTRATION_FILE_EXT_TO_MIME[ext]) {
    return REGISTRATION_FILE_EXT_TO_MIME[ext];
  }

  return null;
}

const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRegistrationUploadId(value) {
  return typeof value === 'string' && UPLOAD_ID_PATTERN.test(value.trim());
}

export function sanitizeRegistrationFileName(name) {
  const base = String(name || 'upload')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return base || 'upload';
}

export function buildRegistrationUploadS3Key({
  externalMerchantId,
  eventId,
  uploadId,
  fileName,
}) {
  const safeName = sanitizeRegistrationFileName(fileName);
  return `private/registration-uploads/${externalMerchantId}/${eventId}/${uploadId}/${safeName}`;
}

export function toPublicFileAnswer(record) {
  return {
    uploadId: record.uploadId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
  };
}

export function extractUploadIdFromAnswer(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && typeof raw.uploadId === 'string') {
    return raw.uploadId.trim();
  }
  return '';
}

export async function createPendingRegistrationUpload({
  eventId,
  externalMerchantId,
  fieldId,
  fileName,
  mimeType,
  buffer,
}) {
  if (!REGISTRATION_FILE_ALLOWED_MIMES.has(mimeType)) {
    throw new Error('File type not allowed');
  }
  if (!buffer?.length || buffer.length > REGISTRATION_FILE_MAX_BYTES) {
    throw new Error('File too large');
  }

  const uploadId = randomUUID();
  const s3Key = buildRegistrationUploadS3Key({
    externalMerchantId,
    eventId,
    uploadId,
    fileName,
  });

  await uploadPrivateObjectToS3(buffer, mimeType, s3Key);

  const expiresAt = new Date(Date.now() + REGISTRATION_FILE_TTL_MS);
  const doc = await RegistrationFileUpload.create({
    uploadId,
    eventId,
    externalMerchantId,
    fieldId,
    s3Key,
    fileName: sanitizeRegistrationFileName(fileName),
    mimeType,
    size: buffer.length,
    status: 'pending',
    expiresAt,
  });

  return doc;
}

/**
 * Resolve pending uploads into ticket-safe answers. s3Key stays in Mongo + EMS registry only.
 */
export async function attachRegistrationFileAnswers(form, answers, eventId) {
  if (!form?.fields?.length) {
    return { valid: true, errors: [], sanitizedAnswers: {}, uploadsForSync: [] };
  }

  const answersObj = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const errors = [];
  const sanitizedAnswers = {};
  const uploadsForSync = [];
  const now = new Date();

  for (const field of form.fields) {
    if (field.type !== 'file') continue;

    const uploadId = extractUploadIdFromAnswer(answersObj[field.id]);
    if (!uploadId) {
      if (field.required) errors.push(`${field.label} is required`);
      continue;
    }
    if (!isRegistrationUploadId(uploadId)) {
      errors.push(`${field.label} has an invalid upload reference`);
      continue;
    }

    const claimed = await RegistrationFileUpload.findOneAndUpdate(
      {
        uploadId,
        eventId: String(eventId),
        fieldId: field.id,
        status: 'pending',
        expiresAt: { $gt: now },
      },
      { $set: { status: 'reserved', reservedAt: now } },
      { new: true }
    ).lean();

    if (!claimed) {
      errors.push(`${field.label} upload not found, expired, or already used`);
      continue;
    }

    sanitizedAnswers[field.id] = toPublicFileAnswer(claimed);
    uploadsForSync.push({
      uploadId: claimed.uploadId,
      fieldId: field.id,
      s3Key: claimed.s3Key,
      fileName: claimed.fileName,
      mimeType: claimed.mimeType,
      size: claimed.size,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedAnswers,
    uploadsForSync,
  };
}

export async function markRegistrationUploadsAttached(uploadIds, ticketMongoId) {
  if (!uploadIds?.length) return;
  await RegistrationFileUpload.updateMany(
    { uploadId: { $in: uploadIds }, status: { $in: ['pending', 'reserved'] } },
    { $set: { status: 'attached', attachedTicketId: ticketMongoId } }
  );
}

export async function releaseReservedRegistrationUploads(uploadIds) {
  if (!uploadIds?.length) return;
  await RegistrationFileUpload.updateMany(
    { uploadId: { $in: uploadIds }, status: 'reserved' },
    { $set: { status: 'pending' }, $unset: { reservedAt: 1 } }
  );
}

export async function deletePendingRegistrationUpload(uploadId) {
  const record = await RegistrationFileUpload.findOne({
    uploadId,
    status: { $in: ['pending', 'reserved'] },
  });
  if (!record) return false;
  try {
    await deletePrivateObjectFromS3(record.s3Key);
  } catch {
    // best-effort
  }
  await RegistrationFileUpload.deleteOne({ _id: record._id });
  return true;
}
