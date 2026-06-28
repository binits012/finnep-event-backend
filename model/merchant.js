import * as model from '../model/mongoModel.js';
import { error, info } from './logger.js';
import { buildCountryMatchFilter } from '../util/regionalAccess.js';
import {
  generateKeyId,
  generateApiSecret,
  hashApiSecret,
  getDefaultScopes,
  normalizeAllowedDomains,
  sanitizeCredentialForResponse
} from '../util/apiCredentials.js';
import { refreshPartnerCorsOriginsFromMerchants } from '../util/corsAllowlist.js'
import { encryptSiloSmtpPassword } from '../util/siloSmtpCrypto.js';
import { normalizeSiloSettings } from '../util/siloSettings.js';
import { inspectSiloDeploymentAws } from '../util/siloDeploymentAws.js';

function attachBffSecret(credential, secret) {
  try {
    credential.bffSecret = encryptSiloSmtpPassword(secret);
  } catch (err) {
    info('Could not encrypt silo BFF secret: %s', err?.message || err);
  }
}

export function merchantHasActiveApiCredential(merchant) {
  return (merchant.apiCredentials || []).some((credential) => credential.status === 'active');
}

function getSiloEnabled(merchant) {
  return Boolean(normalizeSiloSettings(merchant?.siloSettings || {}).enabled);
}

function getDeploymentAction(beforeEnabled, afterEnabled) {
  if (!beforeEnabled && afterEnabled) return 'provision';
  if (beforeEnabled && !afterEnabled) return 'deprovision';
  return null;
}

function applySiloDeploymentIntent(merchant, action) {
  if (!action) return;
  const silo = normalizeSiloSettings(merchant.siloSettings || {});
  const nowIso = new Date().toISOString();
  const nextStatus = action === 'provision' ? 'pending_provision' : 'pending_deprovision';

  silo.deployment = {
    ...silo.deployment,
    mode: 'per_merchant',
    status: nextStatus,
    lastProvisionRequestedAt: nowIso,
    lastError: ''
  };
  merchant.siloSettings = silo;
}

function applySiloProvisionedFromCredentials(merchant) {
  const enabled = merchantHasActiveApiCredential(merchant);
  merchant.siloSettings = normalizeSiloSettings({ enabled }, merchant.siloSettings || {});
}

/** Align siloSettings.enabled with active API credentials (CMS is source of truth). */
export async function reconcileSiloProvisionedFromCredentials(merchantId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) {
    return { changed: false, merchant: null, siloEnabled: false, deploymentAction: null };
  }

  const beforeEnabled = getSiloEnabled(merchant);
  const expectedEnabled = merchantHasActiveApiCredential(merchant);
  const currentEnabled = Boolean(normalizeSiloSettings(merchant.siloSettings || {}).enabled);
  if (expectedEnabled === currentEnabled) {
    return { changed: false, merchant, siloEnabled: currentEnabled, deploymentAction: null };
  }

  applySiloProvisionedFromCredentials(merchant);
  const deploymentAction = getDeploymentAction(beforeEnabled, expectedEnabled);
  applySiloDeploymentIntent(merchant, deploymentAction);
  merchant.updatedAt = new Date();
  await merchant.save();

  info(
    'Reconciled silo provision state: merchantId=%s enabled=%s',
    merchant.merchantId,
    expectedEnabled
  );

  return {
    changed: true,
    merchant,
    siloEnabled: expectedEnabled,
    deploymentAction
  };
}

/** Re-queue AWS provisioning when silo is enabled but the last provision attempt failed. */
export async function retryFailedSiloDeploymentIfNeeded(merchantId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) {
    return { retried: false, merchant: null, deploymentAction: null };
  }

  const silo = normalizeSiloSettings(merchant.siloSettings || {});
  if (!silo.enabled || silo.deployment?.status !== 'provision_failed') {
    return { retried: false, merchant, deploymentAction: null };
  }

  applySiloDeploymentIntent(merchant, 'provision');
  merchant.updatedAt = new Date();
  await merchant.save();

  info('Re-queued failed silo deployment: merchantId=%s', merchant.merchantId);

  return {
    retried: true,
    merchant,
    deploymentAction: 'provision'
  };
}

function normalizeStorefrontHostname(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
}

/** After CloudFront/custom domain is known, add storefront hostnames to active API credentials. */
export async function syncSiloStorefrontAllowedDomains(merchantId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return { changed: false, merchant: null };

  const silo = normalizeSiloSettings(merchant.siloSettings || {});
  const hostnames = [
    normalizeStorefrontHostname(silo.deployment?.cloudfrontDomainName),
    normalizeStorefrontHostname(silo.domain)
  ].filter(Boolean);

  if (hostnames.length === 0) {
    return { changed: false, merchant };
  }

  let changed = false;
  for (const credential of merchant.apiCredentials || []) {
    if (credential.status !== 'active') continue;
    const next = new Set(normalizeAllowedDomains(credential.allowedDomains || []));
    const beforeSize = next.size;
    for (const hostname of hostnames) {
      next.add(hostname);
    }
    if (next.size !== beforeSize) {
      credential.allowedDomains = [...next];
      changed = true;
    }
  }

  if (changed) {
    merchant.updatedAt = new Date();
    await merchant.save();
    await refreshPartnerCorsOriginsFromMerchants();
    info(
      'Synced silo storefront hostnames to API credential allowedDomains: merchantId=%s hostnames=%s',
      merchant.merchantId,
      hostnames.join(', ')
    );
  }

  return { changed, merchant };
}

/**
 * CMS Re-sync: when AWS infra is already healthy, align Mongo status to provisioned
 * and sync credential hostnames — no RabbitMQ, no UpdateDistribution.
 */
export async function reconcileSiloProvisioningFromAws(merchantId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return null;
  if (!merchantHasActiveApiCredential(merchant)) {
    return { error: 'SILO_NOT_ENABLED' };
  }

  const silo = normalizeSiloSettings(merchant.siloSettings || {});
  const inspection = await inspectSiloDeploymentAws({
    merchantId: merchant.merchantId,
    existingDeployment: silo.deployment || {}
  });

  if (!inspection.healthy) {
    info(
      'Silo AWS reconcile skipped — infra not healthy: merchantId=%s issues=%s',
      merchant.merchantId,
      inspection.issues.join('; ')
    );
    return { reconciled: false, merchant, issues: inspection.issues };
  }

  const nowIso = new Date().toISOString();
  silo.deployment = {
    ...silo.deployment,
    mode: 'per_merchant',
    status: 'provisioned',
    s3Bucket: inspection.bucketName,
    s3Region: inspection.bucketRegion || silo.deployment?.s3Region || '',
    cloudfrontDistributionId: inspection.cloudfrontDistributionId,
    cloudfrontDomainName: inspection.cloudfrontDomainName,
    lastProvisionedAt: nowIso,
    lastError: ''
  };
  merchant.siloSettings = silo;
  merchant.updatedAt = new Date();
  await merchant.save();
  await syncSiloStorefrontAllowedDomains(merchant._id);

  info('Silo AWS deployment reconciled from live infra: merchantId=%s', merchant.merchantId);

  return {
    reconciled: true,
    merchant,
    deployment: silo.deployment
  };
}

/** Re-queue AWS provisioning for CMS ops (enabled merchant with active credentials). */
export async function requeueSiloProvisioning(merchantId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return null;
  if (!merchantHasActiveApiCredential(merchant)) {
    return { error: 'SILO_NOT_ENABLED' };
  }

  applySiloDeploymentIntent(merchant, 'provision');
  merchant.updatedAt = new Date();
  await merchant.save();

  info('Re-queued silo provisioning from CMS: merchantId=%s', merchant.merchantId);

  return {
    merchant,
    deploymentAction: 'provision'
  };
}

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

export async function getAllMerchants(filters = {}) {
  try {
    const queryFilter = {};
    if (filters.allowedCountryCodes) {
      const countryFilter = buildCountryMatchFilter(filters.allowedCountryCodes);
      if (countryFilter) {
        queryFilter.country = countryFilter;
      }
    }

    const merchants = await model.Merchant.find(queryFilter);
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

export async function findMerchantByApiKeyId(keyId) {
  try {
    if (!keyId) return null;
    return await model.Merchant.findOne({
      apiCredentials: {
        $elemMatch: { keyId, status: 'active' }
      }
    }).exec();
  } catch (err) {
    error('Error finding merchant by API key:', err);
    throw err;
  }
}

export async function findMerchantByApiKeyIdAnyStatus(keyId) {
  try {
    if (!keyId) return null;
    return await model.Merchant.findOne({
      'apiCredentials.keyId': keyId
    }).exec();
  } catch (err) {
    error('Error finding merchant by API key (any status):', err);
    throw err;
  }
}

export async function issueApiCredential(merchantId, { allowedDomains = [], scopes = [], label = '', serverToServer = true } = {}) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return null;
  const beforeEnabled = getSiloEnabled(merchant);

  const keyId = generateKeyId();
  const secret = generateApiSecret();
  const credential = {
    keyId,
    secretHash: hashApiSecret(secret),
    allowedDomains: normalizeAllowedDomains(allowedDomains),
    scopes: getDefaultScopes(scopes),
    status: 'active',
    label: String(label || '').trim(),
    serverToServer: !!serverToServer,
    createdAt: new Date()
  };
  attachBffSecret(credential, secret);

  merchant.apiCredentials = merchant.apiCredentials || [];
  merchant.apiCredentials.push(credential);
  applySiloProvisionedFromCredentials(merchant);
  const deploymentAction = getDeploymentAction(beforeEnabled, getSiloEnabled(merchant));
  applySiloDeploymentIntent(merchant, deploymentAction);
  merchant.updatedAt = new Date();
  await merchant.save();

  return {
    merchant,
    credential: sanitizeCredentialForResponse(credential),
    secret,
    deploymentAction
  };
}

export async function listApiCredentials(merchantId) {
  const merchant = await model.Merchant.findById(merchantId).lean();
  if (!merchant) return null;
  return (merchant.apiCredentials || []).map(sanitizeCredentialForResponse);
}

export async function rotateApiCredential(merchantId, keyId) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return null;

  const credential = (merchant.apiCredentials || []).find((c) => c.keyId === keyId);
  if (!credential) return null;

  const secret = generateApiSecret();
  credential.secretHash = hashApiSecret(secret);
  attachBffSecret(credential, secret);
  credential.rotatedAt = new Date();
  credential.status = 'active';
  merchant.updatedAt = new Date();
  await merchant.save();

  return {
    merchant,
    credential: sanitizeCredentialForResponse(credential),
    secret
  };
}

export async function updateApiCredential(merchantId, keyId, updates = {}) {
  const merchant = await model.Merchant.findById(merchantId);
  if (!merchant) return null;
  const beforeEnabled = getSiloEnabled(merchant);

  const credential = (merchant.apiCredentials || []).find((c) => c.keyId === keyId);
  if (!credential) return null;

  if (updates.allowedDomains !== undefined) {
    credential.allowedDomains = normalizeAllowedDomains(updates.allowedDomains);
  }
  if (updates.scopes !== undefined) {
    credential.scopes = getDefaultScopes(updates.scopes);
  }
  if (updates.status !== undefined && ['active', 'revoked'].includes(updates.status)) {
    credential.status = updates.status;
  }
  if (updates.label !== undefined) {
    credential.label = String(updates.label || '').trim();
  }
  if (updates.serverToServer !== undefined) {
    credential.serverToServer = !!updates.serverToServer;
  }

  applySiloProvisionedFromCredentials(merchant);
  const deploymentAction = getDeploymentAction(beforeEnabled, getSiloEnabled(merchant));
  applySiloDeploymentIntent(merchant, deploymentAction);
  merchant.updatedAt = new Date();
  await merchant.save();
  return {
    credential: sanitizeCredentialForResponse(credential),
    deploymentAction
  };
}

export async function revokeApiCredential(merchantId, keyId) {
  return updateApiCredential(merchantId, keyId, { status: 'revoked' });
}

export async function touchApiCredentialLastUsed(merchantId, keyId) {
  await model.Merchant.updateOne(
    { _id: merchantId, 'apiCredentials.keyId': keyId },
    { $set: { 'apiCredentials.$.lastUsedAt': new Date() } }
  ).exec();
}

export async function getAllPartnerCorsOrigins() {
  const merchants = await model.Merchant.find({
    apiCredentials: {
      $elemMatch: { status: 'active', allowedDomains: { $exists: true, $ne: [] } }
    }
  }).select('apiCredentials').lean();

  const origins = new Set();
  for (const merchant of merchants) {
    for (const cred of merchant.apiCredentials || []) {
      if (cred.status !== 'active') continue;
      for (const domain of cred.allowedDomains || []) {
        const hostname = String(domain).trim().toLowerCase();
        if (hostname) {
          origins.add(`https://${hostname}`);
          origins.add(`http://${hostname}`);
        }
      }
    }
  }
  return [...origins];
}