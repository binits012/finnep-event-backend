import * as model from '../model/mongoModel.js';
import { error, info } from './logger.js';

export class Merchant {
  constructor(merchantId, name, orgName, country, code, email, companyEmail, phone, companyPhoneNumber, address, companyAddress,
    schemaName, status, website, logo, stripeAccount) {
    this.merchantId = merchantId;
    this.name = name;
    this.orgName = orgName;
    this.country = country;
    this.code = code;
    this.email = email;
    this.companyEmail = companyEmail;
    this.phone = phone;
    this.companyPhoneNumber = companyPhoneNumber;
    this.address = address;
    this.companyAddress = companyAddress;
    this.schemaName = schemaName;
    this.status = status || 'pending';
    this.website = website;
    this.logo = logo;
    this.stripeAccount = stripeAccount;
  }

  async saveToDB() {
    try {
      const merchant = new model.Merchant({
        merchantId: this.merchantId,
        name: this.name,
        orgName: this.orgName,
        country: this.country,
        code: this.code,
        email: this.email,
        companyEmail: this.companyEmail,
        phone: this.phone,
        companyPhoneNumber: this.companyPhoneNumber,
        address: this.address,
        companyAddress: this.companyAddress,
        schemaName: this.schemaName,
        status: this.status,
        website: this.website,
        logo: this.logo,
        stripeAccount: this.stripeAccount
      });
      const savedMerchant = await merchant.save();
      info('Merchant created successfully: %s', savedMerchant._id);
      return savedMerchant;
    } catch (err) {
      error('Error saving merchant:', err);
      throw err;
    }
  }
}

export async function createMerchant(merchantData) {
  try {
    const merchant = new model.Merchant(merchantData);
    const savedMerchant = await merchant.save();
    info('Merchant created successfully: %s', savedMerchant._id);
    return savedMerchant;
  } catch (err) {
    error('Error creating merchant:', err);
    throw err;
  }
}

export async function getMerchantById(id) {
  try {
    const merchant = await model.Merchant.findById(id);
    return merchant;
  } catch (err) {
    error('Error fetching merchant by ID:', err);
    throw err;
  }
}

export async function getMerchantByMerchantId(merchantId) {
  try {
    const merchant = await model.Merchant.findOne({ merchantId: merchantId });
    return merchant;
  } catch (err) {
    error('Error fetching merchant by merchantId:', err);
    throw err;
  }
}

export async function getAllMerchants() {
  try {
    const merchants = await model.Merchant.find({});
    return merchants;
  } catch (err) {
    error('Error fetching all merchants:', err);
    throw err;
  }
}

export async function updateMerchantById(id, updateData) {
  try {
    updateData.updatedAt = Date.now();
    const updatedMerchant = await model.Merchant.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    if (updatedMerchant) {
      info('Merchant updated successfully: %s', id);
    }
    return updatedMerchant;
  } catch (err) {
    error('Error updating merchant:', err);
    throw err;
  }
}

export async function deleteMerchantById(id) {
  try {
    const deletedMerchant = await model.Merchant.findByIdAndDelete(id);
    if (deletedMerchant) {
      info('Merchant deleted successfully: %s', id);
    }
    return deletedMerchant;
  } catch (err) {
    error('Error deleting merchant:', err);
    throw err;
  }
}

export async function genericSearchMerchant(...searchTerms) {
  try {
    // Filter out null, undefined, and empty string values
    const validSearchTerms = searchTerms.filter(term => term != null && term !== '');

    if (validSearchTerms.length === 0) {
      return [];
    }

    // Build the $or query with all valid search terms
    const orConditions = [];

    for (const term of validSearchTerms) {
      orConditions.push(
        { merchantId: term },
        { name: term },
        { orgName: term },
        { email: term },
        { companyEmail: term },
        { phone: term },
        { companyPhoneNumber: term },
        { address: term },
        { companyAddress: term }
      );
    }

    const merchants = await model.Merchant.find({ $or: orConditions });
    return merchants;
  } catch (err) {
    error('Error fetching merchant by generic search:', err);
    throw err;
  }
}

export async function addOrUpdateOtherInfo(id, otherInfo) {
  try {
    const updatedMerchant = await model.Merchant.findByIdAndUpdate(id, { 'otherInfo': otherInfo }, { new: true });
    if (updatedMerchant) {
      info('OtherInfo added or updated successfully: %s', id);
    }
    return updatedMerchant;
  } catch (err) {
    error('Error adding or updating otherInfo:', err);
    throw err;
  }
}