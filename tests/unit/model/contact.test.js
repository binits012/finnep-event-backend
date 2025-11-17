/**
 * Contact Model Unit Tests
 *
 * Tests for:
 * - createContact
 * - getContactById
 * - updateContactById
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock dependencies
const mockContactModel = jest.fn();
    mockContactModel.findById = jest.fn();
    mockContactModel.findOne = jest.fn();
    mockContactModel.findOneAndUpdate = jest.fn();
    mockContactModel.findByIdAndUpdate = jest.fn();
    mockContactModel.save = jest.fn();

const mockModel = {
  Contact: mockContactModel
};

const mockCreateHash = {
  createHashData: jest.fn(),
  readHash: jest.fn(),
  updateHash: jest.fn(),
  deleteHashById: jest.fn()
};

const mockLogger = {
  error: jest.fn()
};

// Use dynamic imports for ES modules
let Contact;
let model;

beforeAll(async () => {
  // Use absolute paths for mocking
  const mongoModelPath = resolve(__dirname, '../../../model/mongoModel.js');
  const loggerPath = resolve(__dirname, '../../../model/logger.js');
  const createHashPath = resolve(__dirname, '../../../util/createHash.js');

  jest.unstable_mockModule(mongoModelPath, () => ({
    default: mockModel,
    Contact: mockContactModel
  }));

  jest.unstable_mockModule(loggerPath, () => ({
    error: mockLogger.error
  }));

  jest.unstable_mockModule(createHashPath, () => ({
    createHashData: mockCreateHash.createHashData,
    readHash: mockCreateHash.readHash,
    updateHash: mockCreateHash.updateHash,
    deleteHashById: mockCreateHash.deleteHashById
  }));

  Contact = await import('../../../model/contact.js');
  model = await import('../../../model/mongoModel.js');
});

describe('Contact Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContactModel.mockClear();
    mockContactModel.findOne.mockClear();
    mockContactModel.findByIdAndUpdate.mockClear();
    mockCreateHash.createHashData.mockClear();
    mockCreateHash.readHash.mockClear();
    mockCreateHash.updateHash.mockClear();
    mockLogger.error.mockClear();
  });

  describe('createContact', () => {
    it('should create a new contact with encrypted email and phone', async () => {
      // Arrange
      const streetName = '123 Main St';
      const phone = '+1234567890';
      const email = 'contact@example.com';
      const userId = new mongoose.Types.ObjectId();

      const mockEmailHash = {
        _id: new mongoose.Types.ObjectId(),
        type: 'email',
        encryptedData: 'encrypted_email'
      };

      const mockPhoneHash = {
        _id: new mongoose.Types.ObjectId(),
        type: 'phone',
        encryptedData: 'encrypted_phone'
      };

      mockCreateHash.createHashData
        .mockResolvedValueOnce(mockEmailHash)
        .mockResolvedValueOnce(mockPhoneHash);

      const savedContactData = {
        _id: new mongoose.Types.ObjectId(),
        streetName: streetName,
        user: userId,
        crypto: [mockEmailHash, mockPhoneHash]
      };

      const mockSavedContact = {
        _id: savedContactData._id,
        streetName: streetName,
        user: userId,
        crypto: [mockEmailHash, mockPhoneHash],
        save: jest.fn().mockResolvedValue(savedContactData),
        saveToDB: jest.fn().mockResolvedValue(savedContactData)
      };

      mockContactModel.mockImplementation(() => mockSavedContact);

      // Act
      const result = await Contact.createContact(streetName, phone, email, userId);

      // Assert
      expect(mockCreateHash.createHashData).toHaveBeenCalledTimes(2);
      expect(mockCreateHash.createHashData).toHaveBeenCalledWith(email, 'email');
      expect(mockCreateHash.createHashData).toHaveBeenCalledWith(phone, 'phone');
      expect(mockContactModel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle encryption errors', async () => {
      // Arrange
      const streetName = '123 Main St';
      const phone = '+1234567890';
      const email = 'contact@example.com';
      const userId = new mongoose.Types.ObjectId();

      const mockError = new Error('Encryption failed');
      mockCreateHash.createHashData.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        Contact.createContact(streetName, phone, email, userId)
      ).rejects.toThrow();
    });
  });

  describe('getContactById', () => {
    it('should retrieve contact with decrypted email and phone', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();
      const mockContact = {
        _id: new mongoose.Types.ObjectId(),
        streetName: '123 Main St',
        user: {
          _id: userId,
          name: 'test@example.com',
          role: { roleType: 'admin' },
          active: true
        },
        crypto: [
          new mongoose.Types.ObjectId(),
          new mongoose.Types.ObjectId()
        ]
      };

      const mockEmailData = {
        _id: mockContact.crypto[0],
        data: 'contact@example.com'
      };

      const mockPhoneData = {
        _id: mockContact.crypto[1],
        data: '+1234567890'
      };

      mockContactModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockContact)
        })
      });

      mockCreateHash.readHash
        .mockResolvedValueOnce(mockEmailData)
        .mockResolvedValueOnce(mockPhoneData);

      // Act
      const result = await Contact.getContactById(userId);

      // Assert
      expect(mockContactModel.findOne).toHaveBeenCalledWith({ user: userId });
      expect(mockCreateHash.readHash).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
      expect(result.contact).toBeDefined();
      expect(Array.isArray(result.contact)).toBe(true);
      expect(result.streetName).toBe('123 Main St');
    });

    it('should return null for non-existent contact', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();

      model.Contact.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null)
        })
      });

      // Act
      const result = await Contact.getContactById(userId);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle hash read errors gracefully', async () => {
      // Arrange
      const userId = new mongoose.Types.ObjectId();
      const mockContact = {
        _id: new mongoose.Types.ObjectId(),
        streetName: '123 Main St',
        user: { _id: userId },
        crypto: [
          new mongoose.Types.ObjectId(),
          new mongoose.Types.ObjectId()
        ]
      };

      mockContactModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockContact)
        })
      });

      const mockError = new Error('Hash read failed');
      mockCreateHash.readHash.mockRejectedValue(mockError);

      // Act
      const result = await Contact.getContactById(userId);

      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
      // Should still return result with null contact data
      expect(result).toBeDefined();
    });
  });

  describe('updateContactById', () => {
    it('should update contact with new encrypted email and phone', async () => {
      // Arrange
      const contactId = new mongoose.Types.ObjectId();
      const streetName = '456 New St';
      const emailId = new mongoose.Types.ObjectId();
      const email = 'newemail@example.com';
      const phoneId = new mongoose.Types.ObjectId();
      const phone = '+9876543210';

      const mockEmailUpdate = {
        _id: emailId,
        encryptedData: 'new_encrypted_email'
      };

      const mockPhoneUpdate = {
        _id: phoneId,
        encryptedData: 'new_encrypted_phone'
      };

      mockCreateHash.updateHash
        .mockResolvedValueOnce(mockEmailUpdate)
        .mockResolvedValueOnce(mockPhoneUpdate);

      const updatedContact = {
        _id: contactId,
        streetName: streetName,
        crypto: [emailId, phoneId]
      };

      mockContactModel.findByIdAndUpdate.mockResolvedValue(updatedContact);

      // Act
      const result = await Contact.updateContactById(
        contactId,
        streetName,
        emailId,
        email,
        phoneId,
        phone
      );

      // Assert
      expect(mockCreateHash.updateHash).toHaveBeenCalledTimes(2);
      expect(mockCreateHash.updateHash).toHaveBeenCalledWith(emailId, email);
      expect(mockCreateHash.updateHash).toHaveBeenCalledWith(phoneId, phone);
      expect(mockContactModel.findByIdAndUpdate).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.streetName).toBe(streetName);
    });

    it('should handle update errors', async () => {
      // Arrange
      const contactId = new mongoose.Types.ObjectId();
      const streetName = '456 New St';
      const emailId = new mongoose.Types.ObjectId();
      const email = 'newemail@example.com';
      const phoneId = new mongoose.Types.ObjectId();
      const phone = '+9876543210';

      const mockError = new Error('Update failed');
      mockCreateHash.updateHash.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        Contact.updateContactById(contactId, streetName, emailId, email, phoneId, phone)
      ).rejects.toThrow();
    });
  });
});


