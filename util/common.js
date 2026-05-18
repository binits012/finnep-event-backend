import * as fs from 'fs/promises';
import * as ICS from 'ics'
import * as QRCode from 'qrcode'
import { validationResult } from 'express-validator'
import  {ObjectId} from 'mongodb'
import moment from 'moment-timezone'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path';
import { fileURLToPath } from 'url';
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { compileMjmlTemplate } from './emailTemplateLoader.js';
import { loadTranslations, normalizeLocale } from './emailTranslations.js';
const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR
dotenv.config()
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';

const websiteHostLabel = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'finnep.fi';
  }
};

const websiteLinkLabel = (url) => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '';
    return path ? `${host}${path}` : host;
  } catch {
    return String(url);
  }
};

export const emailFooterBusinessFromEnv = (options = {}) => ({
  businessId: options.businessId ?? process.env.BUSINESS_ID ?? '3579764-6',
  socialMedidFB: options.socialMedidFB ?? process.env.SOCIAL_MEDIA_FB ?? 'https://www.facebook.com/profile.php?id=61565375592900',
  socialMedidLN: options.socialMedidLN ?? process.env.SOCIAL_MEDIA_LN ?? 'https://www.linkedin.com/company/105069196/admin/dashboard/'
});

/** Public "contact us" / support address for footers and buttons (PLATFORM_EMAIL), not SMTP/from (EMAIL_USERNAME). */
export const resolveBrandingContactEmail = () =>
  process.env.PLATFORM_EMAIL || process.env.EMAIL_USERNAME || 'info@finnep.fi';

const acknowledgementBrandingFromEnv = () => {
  const companyName = process.env.COMPANY_TITLE || 'Finnep';
  const brandingContactEmail = resolveBrandingContactEmail();
  const companyWebsiteUrl = process.env.COMPANY_WEBSITE_URL || 'https://finnep.fi';
  const companyWebsiteLabel = process.env.COMPANY_WEBSITE_LABEL || websiteHostLabel(companyWebsiteUrl);
  const careersUrl = process.env.COMPANY_CAREERS_URL || `${companyWebsiteUrl.replace(/\/$/, '')}/careers`;
  const careersLabel = process.env.COMPANY_CAREERS_LABEL || websiteLinkLabel(careersUrl);
  const platformTeamSignature = process.env.COMPANY_TEAM_SIGNATURE || `The ${companyName} Team`;
  const hiringTeamSignature = process.env.COMPANY_HIRING_TEAM_SIGNATURE || `The ${companyName} Hiring Team`;
  return {
    companyName,
    brandingContactEmail,
    companyWebsiteUrl,
    companyWebsiteLabel,
    careersUrl,
    careersLabel,
    platformTeamSignature,
    hiringTeamSignature
  };
};
export const manipulatePhoneNumber = async (phoneNumber) =>{
    if(/[aA-zZ].*/.test(phoneNumber)){
        return null
    }
    let sanitaizedPhoneNumber = phoneNumber.replaceAll("-","").replaceAll("(","").replaceAll(")","")
    if(sanitaizedPhoneNumber.startsWith('+358')) {
         //probably this is ok
        return phoneNumber
    }
    if(sanitaizedPhoneNumber.startsWith('0')){
        sanitaizedPhoneNumber = sanitaizedPhoneNumber.replace('0','')
        sanitaizedPhoneNumber = process.env.PREFIX_PHONE+sanitaizedPhoneNumber
        return sanitaizedPhoneNumber
    }
    if(sanitaizedPhoneNumber.startsWith('4') || sanitaizedPhoneNumber.startsWith('5') ){
        sanitaizedPhoneNumber = process.env.PREFIX_PHONE+sanitaizedPhoneNumber
        return sanitaizedPhoneNumber
    }
    return phoneNumber

}

export const formatDate = async (dateString) =>{
    const dateSplit = dateString.split('/')
    const day = dateSplit[0]
    const month = dateSplit[1]
    const year = dateSplit[2]
    const tempString = year+"-"+month+"-"+day
    return tempString
}

export const formateDateWithHash = async (date) =>{
    return  moment(date).format("DD/MM/YYYY")
}

export const convertDateTimeWithTimeZone = async (eventDate, eventTimeZone = "Europe/Helsinki") =>{
    return  moment(eventDate).tz(eventTimeZone).format('YYYY-MM-DDTHH:mm:ss')
}
//redis-client
export const getCacheByKey = async(redisClient, key) =>{
    try{
        return JSON.parse(await redisClient.get(key))
    }catch(error){
        console.log(error)
        return error
    }

}

export const setCacheByKey = async(redisClient, key, data) =>{
    try{
        return await redisClient.set(key, JSON.stringify(data))
    }catch(error){
        return error
    }

}

export const removeCacheByKey = async(redisClient, key) =>{
    return await redisClient.del(key);
}

export const formatTime =  (time) =>{
    let hour = Math.floor(time/60)
    let min = time%60
    if(min < 10) min = '0'+min
    if(hour<10) hour = '0'+hour;
    return hour+':'+min
}

export const timeInMinutes = (time) =>{
    const hour = parseInt(time.substring(0, 2)) * 60
    const min = time.substring(3, 5)
    return hour + parseInt(min)
}

export const sanitizeLanguage = (lang) =>{
    let myLang = 'en'
    switch (lang) {
        case 'Finnish':
        case 'fi':
            myLang = 'fi'
          break

        case 'Swedish':
        case 'sv':
            myLang = 'sv'
          break;
        default:
          myLang = 'en'
      }
    return myLang
}

export const sortByDate = (a, b) =>{
    return Date.parse(b.reservationDate) - Date.parse(a.reservationDate)
}


export const validateParam = async (id) =>{
    return ObjectId.isValid(id)
}

export  const validate = async (validations, req) => {

    for (let validation of validations) {

        const result = await validation.run(req)
        if (result.errors.length)  break
    }

    return validationResult(req)
  }

export  const generateQRCode = async(ticketId) =>{
    let opts = {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        quality: 0.3,
        margin: 1,
        color: {
          dark:"#010599FF",
          light:"#FFBF60FF"
        }
    }
    return await new Promise((resolve, reject)=>{
        QRCode.toDataURL(ticketId, opts, function (err, url) {

            if(err) reject(err)
            resolve(url)
        })
    })
    /*
    QRCode.toDataURL(process.env.FQDN+'/api/ticket/'+ticketId, opts, function (err, url) {
        callback(err,url)
    })
    */
}
const pickFirstIanaTimezoneString = (...candidates) => {
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return null;
};

/** Read timezone from merchant doc (plain object, lean, or Map otherInfo). */
const timezoneFromMerchantDoc = (merchant) => {
    if (!merchant || typeof merchant !== 'object') return null;
    const fromTop = pickFirstIanaTimezoneString(
        merchant.timezone,
        merchant.timeZone,
        merchant.eventTimezone,
        merchant.defaultTimezone,
        merchant.default_time_zone
    );
    if (fromTop) return fromTop;
    const oi = merchant.otherInfo;
    if (oi instanceof Map) {
        return pickFirstIanaTimezoneString(
            oi.get('timezone'),
            oi.get('eventTimezone'),
            oi.get('ianaTimezone')
        );
    }
    if (oi && typeof oi === 'object') {
        return pickFirstIanaTimezoneString(oi.timezone, oi.eventTimezone, oi.ianaTimezone);
    }
    return null;
};

/**
 * IANA zone for ICS: prefer event/venue data over merchant defaults.
 * Stored eventDate/eventEndDate are UTC instants.
 */
const resolveEventIanaTimezone = (event) => {
    const venue = event?.venue && typeof event.venue === 'object' ? event.venue : null;
    const venueInfo = event?.venueInfo && typeof event.venueInfo === 'object' ? event.venueInfo : null;
    const merchantDoc = event?.merchant && typeof event.merchant === 'object' ? event.merchant : null;

    const resolved = pickFirstIanaTimezoneString(
        event?.eventTimezone,
        event?.event_timezone,
        venue?.timezone,
        venueInfo?.timezone,
        timezoneFromMerchantDoc(merchantDoc),
        process.env.TIME_ZONE,
        process.env.DEFAULT_EVENT_IANA_TIMEZONE
    );
    return resolved || 'Europe/Helsinki';
};

/** RFC 5545 escape for TEXT in property values (e.g. TZNAME). */
const escapeIcsTextValue = (s) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

/** RFC 5545 line endings: CRLF. Helps Apple Mail / Calendar and other strict parsers. */
const normalizeIcsCrLf = (icsText) => icsText
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\r\n');

/**
 * Minimal VTIMEZONE so DTSTART;TZID / DTEND;TZID reference a definition in the same calendar.
 * Offset at event start; tuned for web + mobile importers (Google, Microsoft, Yahoo, Apple).
 */
const buildMinimalVtimezoneBlock = (tz, startInstant) => {
    if (!tz || !moment.tz.zone(tz)) return '';
    const m = moment(startInstant).tz(tz);
    const offsetMinutes = m.utcOffset();
    const fmtIcsOffset = (mins) => {
        const sign = mins < 0 ? '-' : '+';
        const total = Math.abs(mins);
        const hh = String(Math.floor(total / 60)).padStart(2, '0');
        const mm = String(total % 60).padStart(2, '0');
        return `${sign}${hh}${mm}`;
    };
    const o = fmtIcsOffset(offsetMinutes);
    const rawAbbr = m.format('z') || 'STD';
    const tzName = escapeIcsTextValue(rawAbbr);
    return (
        'BEGIN:VTIMEZONE\r\n'
        + `TZID:${tz}\r\n`
        + 'BEGIN:STANDARD\r\n'
        + 'DTSTART:19700101T000000\r\n'
        + `TZOFFSETFROM:${o}\r\n`
        + `TZOFFSETTO:${o}\r\n`
        + `TZNAME:${tzName}\r\n`
        + 'END:STANDARD\r\n'
        + 'END:VTIMEZONE'
    );
};

const injectVtimezoneAfterCalendarHeader = (icsText, tz, startInstant) => {
    const block = buildMinimalVtimezoneBlock(tz, startInstant);
    if (!block) return icsText;
    return icsText.replace(/(X-PUBLISHED-TTL:PT1H\r?\n)/, `$1${block}\r\n`);
};

/** RFC5545 local time in a zone: YYYYMMDDTHHMMSS (no Z), derived from a UTC instant. */
const formatIcsDateTimeInZone = (instant, tz) => {
    const m = moment(instant).tz(tz);
    const pad = (n) => String(n).padStart(2, '0');
    return `${m.year()}${pad(m.month() + 1)}${pad(m.date())}T${pad(m.hour())}${pad(m.minute())}${pad(m.second())}`;
};

/**
 * `ics` emits DTSTART/DTEND with trailing Z (UTC). Replace with TZID + local wall time in `tz`
 * (same absolute instant).
 */
const applyIanaTzidToUtcDtLines = (icsText, tz, startInstant, endInstant) => {
    const startLocal = formatIcsDateTimeInZone(startInstant, tz);
    let out = icsText.replace(
        /^DTSTART:\d{8}T\d{6}Z(\r?\n)/m,
        `DTSTART;TZID=${tz}:${startLocal}$1`
    );
    if (endInstant != null) {
        const endLocal = formatIcsDateTimeInZone(endInstant, tz);
        out = out.replace(
            /^DTEND:\d{8}T\d{6}Z(\r?\n)/m,
            `DTEND;TZID=${tz}:${endLocal}$1`
        );
    }
    return out;
};

/**
 * Build an .ics VEVENT for a ticket.
 * - eventDate / eventEndDate: UTC instants.
 * - Timezone: event.eventTimezone / event_timezone first, then venue/venueInfo timezone,
 *   then merchant timezone fields, then TIME_ZONE / DEFAULT_EVENT_IANA_TIMEZONE, else Europe/Helsinki.
 * - Minimal VTIMEZONE + DTSTART/DTEND;TZID (local wall time), CRLF throughout — aligned with
 *   typical consumer clients: Google Calendar, Outlook / Hotmail, Yahoo, Apple Mail & Calendar (iOS).
 */
export const generateICS = async (event, ticketId) => {
    const eventDate = event?.eventDate;
    if (!eventDate) {
        throw new Error('eventDate is required for ICS generation');
    }
    const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
    if (Number.isNaN(d.getTime())) {
        throw new Error('Invalid eventDate for ICS generation');
    }

    const tz = resolveEventIanaTimezone(event);

    const start = [
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds()
    ];

    let end = null;
    let endInstant = null;
    const endRaw = event.eventEndDate ?? event.event_end_date;
    if (endRaw) {
        const de = endRaw instanceof Date ? endRaw : new Date(endRaw);
        if (!Number.isNaN(de.getTime()) && de.getTime() > d.getTime()) {
            endInstant = de;
            end = [
                de.getUTCFullYear(),
                de.getUTCMonth() + 1,
                de.getUTCDate(),
                de.getUTCHours(),
                de.getUTCMinutes(),
                de.getUTCSeconds()
            ];
        }
    }

    let geo;
    if (typeof event.eventLocationGeoCode === 'string' && event.eventLocationGeoCode.includes(',')) {
        const parts = event.eventLocationGeoCode.split(',');
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]?.trim());
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            geo = { lat, lon };
        }
    }

    const icsData = {
        title: event.eventTitle,
        description: event.eventDescription,
        busyStatus: 'Busy',
        location: event.eventLocationAddress,
        ...(geo && { geo }),
        start,
        startInputType: 'utc',
        startOutputType: 'utc',
        ...(end
            ? {
                end,
                endInputType: 'utc',
                endOutputType: 'utc'
            }
            : { duration: { hours: 5, minutes: 0 } }),
        status: 'CONFIRMED',
        classification: 'PRIVATE',
        organizer: { name: process.env.COMPANY_TITLE, email: process.env.EMAIL_USERNAME },
        uid: String(ticketId)
    };

    const raw = await new Promise((resolve, reject) => {
        ICS.createEvent(icsData, (err, value) => {
            if (err) reject(err);
            else resolve(value);
        });
    });

    const withVtimezone = injectVtimezoneAfterCalendarHeader(raw, tz, d);
    const withTzid = applyIanaTzidToUtcDtLines(withVtimezone, tz, d, endInstant);
    return normalizeIcsCrLf(withTzid);
};

export  const loadEmailTemplate = async (fileLocation, variablesOrEventTitle, eventPromotionalPhoto, qrCodeRef, otp, locale = 'en-US') => {
    // Replace .html with .mjml in file path
    const mjmlPath = fileLocation.replace('.html', '.mjml');

    // Check if first parameter after fileLocation is an object (new signature) or string (legacy signature)
    let variables;
    if (typeof variablesOrEventTitle === 'object' && variablesOrEventTitle !== null && !Array.isArray(variablesOrEventTitle)) {
      // New signature: (fileLocation, variablesObject, locale)
      variables = variablesOrEventTitle;
    } else {
      // Legacy signature: (fileLocation, eventTitle, eventPromotionalPhoto, qrCodeRef, otp, locale)
      variables = {
        eventTitle: variablesOrEventTitle || '',
        eventPromotionalPhoto: eventPromotionalPhoto || '',
        qrcodeData: qrCodeRef || '',
        ticketCode: otp || ''
      };
    }

    // Extract template name from file path (e.g., 'ticket_template' from './emailTemplates/ticket_template.mjml')
    const templateName = path.basename(mjmlPath, '.mjml');

    // Normalize locale
    const normalizedLocale = normalizeLocale(locale);

    // Load translations for this template and locale
    const translations = await loadTranslations(templateName, normalizedLocale);

    // Merge translations into variables object
    variables.t = translations;

    return await compileMjmlTemplate(mjmlPath, variables);
  }

export const loadEmailTemplateForMerchant = async (fileLocation, orgName, dashboardUrl, locale = 'en-US', options = {}) => {
    // Replace .html with .mjml in file path
    const mjmlPath = fileLocation.replace('.html', '.mjml');

    // Extract template name from file path (e.g., 'merchant_arrival' from './emailTemplates/merchant_arrival.mjml')
    const templateName = path.basename(mjmlPath, '.mjml');

    // Normalize locale
    const normalizedLocale = normalizeLocale(locale);

    // Load translations for this template and locale
    const translations = await loadTranslations(templateName, normalizedLocale);

    const companyLogo = options.companyLogo || process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
    const companyName = options.companyName || process.env.COMPANY_TITLE || 'Finnep';
    const brandingContactEmail =
      options.brandingContactEmail || options.contactEmail || resolveBrandingContactEmail();
    const platformTeamSignature = options.platformTeamSignature || process.env.COMPANY_TEAM_SIGNATURE || `The ${companyName} Team`;
    const closingRegards = translations?.closingRegards || 'Best regards,';

    const variables = {
      orgName,
      dashboardUrl,
      companyLogo,
      companyName,
      brandingContactEmail,
      platformTeamSignature,
      closingRegards,
      ...emailFooterBusinessFromEnv(options),
      t: translations // Pass translations as 't' object for Handlebars {{t.key}} access
    };
    return await compileMjmlTemplate(mjmlPath, variables);
}

export const loadFeedbackTemplate = async (name, email, subject, message) => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'feedback_acknowledgement.mjml');
    const variables = {
      name,
      email,
      subject,
      message,
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      ...acknowledgementBrandingFromEnv()
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const loadCareerTemplate = async (name, email, phone, position, experience, availability) => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'career_acknowledgement.mjml');
    const variables = {
      name,
      email,
      phone: phone || 'Not provided',
      position,
      experience: experience || 'Not provided',
      availability: availability || 'Not specified',
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      ...acknowledgementBrandingFromEnv()
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const loadVerificationCodeTemplate = async (code, locale = 'en-US') => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'verification_code.mjml');
    const currentYear = new Date().getFullYear();
    const companyName = process.env.COMPANY_TITLE || 'Finnep';

    // Normalize locale
    const normalizedLocale = normalizeLocale(locale);

    // Load translations for verification_code template
    const translations = await loadTranslations('verification_code', normalizedLocale);

    const variables = {
      verificationCode: code,
      currentYear,
      companyName,
      brandingContactEmail: resolveBrandingContactEmail(),
      t: translations // Pass translations as 't' object for Handlebars {{t.key}} access
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

const DEFAULT_EVENT_IMAGE = 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800';

export const loadWaitlistJoinedTemplate = async (eventTitle, locale = 'en-US', options = {}) => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'waitlist_joined.mjml');
    const currentYear = new Date().getFullYear();
    const companyName = process.env.COMPANY_TITLE || 'Finnep';
    const companyLogo = options.companyLogo || process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
    const eventPromotionalPhoto = options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE;

    const normalizedLocale = normalizeLocale(locale);
    const translations = await loadTranslations('waitlist_joined', normalizedLocale);

    const variables = {
        eventTitle: eventTitle || 'Event',
        currentYear,
        companyName,
        companyLogo,
        eventPromotionalPhoto,
        brandingContactEmail: resolveBrandingContactEmail(),
        t: translations
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

/**
 * Load presale link email template (MJML). Used when sending one-time presale links to waitlist.
 * @param {string} eventTitle
 * @param {string} presaleLink - Full URL with ?presale=TOKEN
 * @param {number} validHours - e.g. 24
 * @param {string} locale
 * @param {{ companyLogo?: string, eventPromotionalPhoto?: string }} options
 */
export const loadPresaleLinkTemplate = async (eventTitle, presaleLink, validHours, locale = 'en-US', options = {}) => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'presale_link.mjml');
    const currentYear = new Date().getFullYear();
    const companyName = process.env.COMPANY_TITLE || 'Finnep';
    const companyLogo = options.companyLogo || process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
    const eventPromotionalPhoto = options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE;

    const normalizedLocale = normalizeLocale(locale);
    const translations = await loadTranslations('presale_link', normalizedLocale);

    const variables = {
        eventTitle: eventTitle || 'Event',
        presaleLink,
        validHours: String(validHours),
        currentYear,
        companyName,
        companyLogo,
        eventPromotionalPhoto,
        brandingContactEmail: resolveBrandingContactEmail(),
        t: translations
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

/**
 * Load "tickets available again" email template (MJML). Used when sold-out event has tickets again.
 * @param {string} eventTitle
 * @param {string} eventUrl - Full URL to event page
 * @param {string} locale
 * @param {{ companyLogo?: string, eventPromotionalPhoto?: string }} options
 */
export const loadSoldOutAvailableTemplate = async (eventTitle, eventUrl, locale = 'en-US', options = {}) => {
    const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'sold_out_available.mjml');
    const currentYear = new Date().getFullYear();
    const companyName = process.env.COMPANY_TITLE || 'Finnep';
    const companyLogo = options.companyLogo || process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
    const eventPromotionalPhoto = options.eventPromotionalPhoto || DEFAULT_EVENT_IMAGE;

    const normalizedLocale = normalizeLocale(locale);
    const translations = await loadTranslations('sold_out_available', normalizedLocale);

    const variables = {
        eventTitle: eventTitle || 'Event',
        eventUrl,
        currentYear,
        companyName,
        companyLogo,
        eventPromotionalPhoto,
        brandingContactEmail: resolveBrandingContactEmail(),
        t: translations
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const getCloudFrontUrl = async (photoLink) =>{
const cloudFrontUrl = photoLink.replace(
    /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/,
    process.env.CLOUDFRONT_URL
);
const encodedCloudFrontUrl = encodeURI(cloudFrontUrl);
const policy = {
    Statement: [
        {
        Resource: encodedCloudFrontUrl,
        Condition: {
            DateLessThan: {
            "AWS:EpochTime": Math.floor(Date.now() / 1000) + (30*24 * 60 * 60) // time in 30 days
            },
        },
        },
    ],
};
const policyString = JSON.stringify(policy);
// Create signed CloudFront URL
const signedUrl = getSignedUrl({
    keyPairId,
    privateKey,
    policy:policyString
});
return signedUrl
}

export const createCode = async (codeLength=10) =>{

    let otp = '';
    for (let i = 0; i < codeLength; i++) {
        otp += CHARACTERS.charAt(crypto.randomInt(0, CHARACTERS.length));
    }
    return otp
}

/**
 * Re-export normalizeLocale for use in controllers
 */
export { normalizeLocale };

/**
 * Extracts locale from request (BCP 47 format)
 * Checks body (for POST), then query, then Accept-Language header
 * @param {Object} req - Express request object
 * @returns {string} Normalized locale (e.g., 'en-US', 'fi-FI')
 */
export const extractLocaleFromRequest = (req) => {
  // Explicit locale in body (e.g. waitlist send-code, so email template matches app language)
  if (req.body && req.body.locale) {
    return normalizeLocale(req.body.locale);
  }
  // Query parameter
  if (req.query && req.query.locale) {
    return normalizeLocale(req.query.locale);
  }
  // Accept-Language header
  const acceptLanguage = req.headers && req.headers['accept-language'];
  if (acceptLanguage) {
    const languages = acceptLanguage.split(',');
    if (languages.length > 0) {
      const primaryLang = languages[0].split(';')[0].trim();
      return normalizeLocale(primaryLang);
    }
  }
  return 'en-US';
}