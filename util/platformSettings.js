import * as Setting from '../model/setting.js';
import { normalizeIso3166Alpha2 } from './iso3166Alpha2.js';
import { resolveBrandingContactEmail, emailFooterBusinessFromEnv } from './common.js';
import { mergeBusinessLandingBeforeValidate } from './businessLanding.js';

const HEADER_COUNTRY = 'x-country-code';

/**
 * @param {import('express').Request | null | undefined} req
 * @returns {string|null} normalized alpha-2 or null
 */
export function parseRequestMarketCountryCode(req) {
  if (!req || !req.headers) return null;
  const raw = req.headers[HEADER_COUNTRY] ?? req.headers[HEADER_COUNTRY.toUpperCase()];
  if (raw == null) return null;
  const asString = Array.isArray(raw) ? raw[0] : raw;
  return normalizeIso3166Alpha2(String(asString));
}

function mapLikeToPlain(m) {
  if (!m) return {};
  if (m instanceof Map) return Object.fromEntries(m.entries());
  if (typeof m === 'object') return { ...m };
  return {};
}

function docToPlain(doc) {
  if (!doc) return null;
  return doc.toObject ? doc.toObject() : doc;
}

function otherInfoToPlain(oi) {
  if (!oi) return {};
  if (oi instanceof Map) return Object.fromEntries(oi.entries());
  if (typeof oi === 'object') return { ...oi };
  return {};
}

export function pickDefaultPlatformDoc(settingsArray) {
  if (!Array.isArray(settingsArray) || settingsArray.length === 0) return null;
  const def = settingsArray.find((s) => s && s.isPlatformDefault === true);
  if (def) return def;
  return settingsArray[0];
}

export function pickCountryPlatformDoc(settingsArray, countryCode) {
  if (!countryCode || !Array.isArray(settingsArray)) return null;
  return settingsArray.find((s) => s && String(s.marketCountryCode || '').toUpperCase() === countryCode) || null;
}

function shallowMergeOtherInfo(a, b) {
  const pa = otherInfoToPlain(a);
  const pb = otherInfoToPlain(b);
  const merged = { ...pa, ...pb };
  if (pa.businessLanding || pb.businessLanding) {
    merged.businessLanding = mergeBusinessLandingBeforeValidate(
      pa.businessLanding,
      pb.businessLanding,
    );
  }
  return merged;
}

/**
 * Merge default + optional country setting documents (country overlays default).
 */
export function mergePlatformSettingDocs(defaultDocPlain, countryDocPlain) {
  const d = defaultDocPlain || {};
  const c = countryDocPlain || {};
  const contactDefault = mapLikeToPlain(d.contactInfo);
  const contactCountry = mapLikeToPlain(c.contactInfo);
  const socialDefault = mapLikeToPlain(d.socialMedia);
  const socialCountry = mapLikeToPlain(c.socialMedia);
  return {
    aboutSection: c.aboutSection ?? d.aboutSection ?? '',
    contactInfo: { ...contactDefault, ...contactCountry },
    socialMedia: { ...socialDefault, ...socialCountry },
    otherInfo: shallowMergeOtherInfo(d.otherInfo, c.otherInfo)
  };
}

/**
 * @param {ReturnType<typeof mergePlatformSettingDocs>} merged
 * @param {'market'|'default'|'env'} tier
 */
export function buildBrandingFromMerged(merged, tier) {
  const contact = merged?.contactInfo || {};
  const oi = merged?.otherInfo && typeof merged.otherInfo === 'object' ? merged.otherInfo : {};
  const companyName = oi.companyTitle || process.env.COMPANY_TITLE || 'Finnep';
  const companyLogo = oi.companyLogo || process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
  const brandingContactEmail =
    (typeof contact.email === 'string' && contact.email.trim()) || resolveBrandingContactEmail();
  const businessId = (typeof oi.platformBusinessId === 'string' && oi.platformBusinessId.trim()) ||
    process.env.BUSINESS_ID ||
    '3579764-6';
  const sm = merged?.socialMedia || {};
  const socialMedidFBResolved = sm.fb || process.env.SOCIAL_MEDIA_FB || 'https://www.facebook.com/profile.php?id=61565375592900';
  const socialMedidLNResolved = sm.linkedin || sm.ln || process.env.SOCIAL_MEDIA_LN || 'https://www.linkedin.com/company/105069196/admin/dashboard/';
  const footer = emailFooterBusinessFromEnv({
    businessId,
    socialMedidFB: socialMedidFBResolved,
    socialMedidLN: socialMedidLNResolved
  });
  return {
    tier,
    companyName,
    companyLogo,
    brandingContactEmail,
    businessId: footer.businessId,
    socialMedidFB: footer.socialMedidFB,
    socialMedidLN: footer.socialMedidLN
  };
}

/**
 * @param {string|null|undefined} countryCode — null/undefined = global default path only (workers)
 */
export async function resolveMergedPlatformSettings(countryCode) {
  const raw = await Setting.getSetting();
  const settings = Array.isArray(raw) && !(raw instanceof Error) ? raw : [];
  const defaultDoc = pickDefaultPlatformDoc(settings);
  const countryNorm = countryCode ? normalizeIso3166Alpha2(countryCode) : null;
  const countryDoc = countryNorm ? pickCountryPlatformDoc(settings, countryNorm) : null;

  let tier = 'env';
  if (defaultDoc) tier = 'default';
  if (countryNorm && countryDoc) tier = 'market';

  const merged = mergePlatformSettingDocs(docToPlain(defaultDoc), docToPlain(countryDoc));
  return { merged, tier, countryCode: countryNorm, settings };
}

/**
 * Branding bundle for MJML / ticket templates.
 * @param {string|null|undefined} countryCode
 */
export async function resolvePlatformBrandingAsync(countryCode) {
  const { merged, tier } = await resolveMergedPlatformSettings(countryCode);
  return buildBrandingFromMerged(merged, tier);
}

/**
 * Public payload helper: merged setting slice + tier (for storefront).
 */
export async function resolvePublicPlatformSettingSlice(countryCode) {
  const { merged, tier, countryCode: norm } = await resolveMergedPlatformSettings(countryCode);
  return {
    platformConfigTier: tier,
    platformCountryCode: norm,
    aboutSection: merged.aboutSection,
    contactInfo: merged.contactInfo,
    socialMedia: merged.socialMedia,
    otherInfo: merged.otherInfo
  };
}
