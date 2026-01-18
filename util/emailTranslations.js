import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supported locales matching finnep-eventapp client
const SUPPORTED_LOCALES = [
  'en-US', // English (default)
  'fi-FI', // Finnish
  'sv-SE', // Swedish
  'da-DK', // Danish
  'de-DE', // German
  'es-ES', // Spanish
  'fr-FR', // French
  'no-NO', // Norwegian
  'pt-PT'  // Portuguese
];

/**
 * Normalizes BCP 47 locale format
 * Handles variations like 'en', 'en-US', 'en_US' → 'en-US'
 * @param {string} locale - Locale string (can be BCP 47 format or short code)
 * @returns {string} Normalized locale (e.g., 'en-US') or 'en-US' if invalid
 */
export const normalizeLocale = (locale) => {
  if (!locale || typeof locale !== 'string') {
    return 'en-US';
  }

  // Normalize separators (handle both '-' and '_')
  let normalized = locale.trim().replace('_', '-');

  // Handle short codes (e.g., 'en' → 'en-US', 'fi' → 'fi-FI')
  const shortCodeMap = {
    'en': 'en-US',
    'fi': 'fi-FI',
    'sv': 'sv-SE',
    'da': 'da-DK',
    'de': 'de-DE',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'no': 'no-NO',
    'pt': 'pt-PT'
  };

  // Check if it's a short code
  if (shortCodeMap[normalized.toLowerCase()]) {
    normalized = shortCodeMap[normalized.toLowerCase()];
  }

  // Validate against supported locales
  if (SUPPORTED_LOCALES.includes(normalized)) {
    return normalized;
  }

  // Try to match by language code (e.g., 'en-GB' → 'en-US')
  const langCode = normalized.split('-')[0]?.toLowerCase();
  if (langCode && shortCodeMap[langCode]) {
    return shortCodeMap[langCode];
  }

  // Default to en-US if no match
  return 'en-US';
};

/**
 * Loads translation JSON file for a template and locale
 * Falls back to en-US if locale file not found
 * @param {string} templateName - Template name (e.g., 'verification_code', 'merchant_suspended')
 * @param {string} locale - BCP 47 locale (e.g., 'en-US', 'fi-FI')
 * @returns {Promise<Object>} Translation object with all strings
 */
export const loadTranslations = async (templateName, locale = 'en-US') => {
  const normalizedLocale = normalizeLocale(locale);
  const translationsDir = path.join(__dirname, '../emailTemplates/locales');

  // Try to load the requested locale
  const translationFile = path.join(translationsDir, `${templateName}_${normalizedLocale}.json`);

  try {
    const content = await fs.readFile(translationFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    // Fallback to en-US if locale file not found
    if (normalizedLocale !== 'en-US') {
      console.warn(`Translation file not found for ${templateName}_${normalizedLocale}.json, falling back to en-US`);
      const fallbackFile = path.join(translationsDir, `${templateName}_en-US.json`);
      try {
        const content = await fs.readFile(fallbackFile, 'utf8');
        return JSON.parse(content);
      } catch (fallbackError) {
        console.error(`Failed to load fallback translation for ${templateName}:`, fallbackError);
        return {}; // Return empty object if even fallback fails
      }
    } else {
      console.error(`Failed to load translation for ${templateName}_en-US.json:`, error);
      return {}; // Return empty object if en-US also fails
    }
  }
};

/**
 * Gets localized email subject line
 * @param {string} templateName - Template name
 * @param {string} locale - BCP 47 locale
 * @param {Object} variables - Additional variables for subject interpolation
 * @returns {Promise<string>} Localized subject line
 */
export const getEmailSubject = async (templateName, locale = 'en-US', variables = {}) => {
  const translations = await loadTranslations(templateName, locale);
  let subject = translations.subject || translations.title || '';

  // Replace variables in subject (e.g., {{companyName}})
  if (subject && variables) {
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      subject = subject.replace(regex, variables[key] || '');
    });
  }

  return subject || 'Email Notification';
};

