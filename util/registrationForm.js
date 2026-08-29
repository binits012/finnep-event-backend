/** Event registration form schema + answer validation (free or paid checkout). */

export const REGISTRATION_FIELD_TYPES = ['text', 'phone', 'textarea', 'select', 'checkbox', 'number', 'file'];

export const REGISTRATION_FORM_LIMITS = {
    maxFields: 20,
    maxLabelLength: 200,
    maxPlaceholderLength: 200,
    maxTextAnswerLength: 2000,
    maxSelectOptions: 50,
    maxOptionLength: 200,
    maxFieldIdLength: 50,
    maxFileFields: 3,
};

const RESERVED_FIELD_IDS = new Set([
    'email',
    'confirmemail',
    'quantity',
    'marketingoptin',
    'ticketid',
    'eventid',
]);

const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]*$/i;

function normalizeFieldType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    return REGISTRATION_FIELD_TYPES.includes(normalized) ? normalized : null;
}

function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options
        .map((opt) => String(opt ?? '').trim())
        .filter(Boolean)
        .slice(0, REGISTRATION_FORM_LIMITS.maxSelectOptions)
        .map((opt) => opt.slice(0, REGISTRATION_FORM_LIMITS.maxOptionLength));
}

function normalizeFileAccept(accept) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    const input = Array.isArray(accept) ? accept : [];
    const normalized = input
        .map((v) => String(v ?? '').trim().toLowerCase())
        .filter((v) => allowed.has(v));
    return normalized.length > 0 ? normalized : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
}

/** Read registration form from event.otherInfo (Mongo synced from EMS other_info). */
export function getRegistrationFormFromEvent(event) {
    const raw =
        event?.otherInfo?.registrationForm ??
        event?.other_info?.registrationForm ??
        event?.registration_form ??
        null;
    return normalizeRegistrationForm(raw);
}

/** GA-only for now — seat-selection / seated events do not expose custom fields yet. */
export function isRegistrationFormSupportedForEvent(event) {
    if (event?.isSeatedEvent === true) return false;
    if (event?.venue?.hasSeatSelection === true) return false;
    if (event?.otherInfo?.eventExtraInfo?.hasSeatSelection === true) return false;
    if (event?.venue?.pricingModel === 'pricing_configuration') return false;
    if (event?.venue?.lockedManifestId) return false;
    return true;
}

/** Sanitize form schema stored on the event. Returns null when no usable fields. */
export function normalizeRegistrationForm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const fieldsInput = Array.isArray(raw.fields) ? raw.fields : [];
    const seenIds = new Set();
    const fields = [];
    let fileFieldCount = 0;

    for (const field of fieldsInput.slice(0, REGISTRATION_FORM_LIMITS.maxFields)) {
        if (!field || typeof field !== 'object') continue;
        const id = String(field.id || '').trim().slice(0, REGISTRATION_FORM_LIMITS.maxFieldIdLength);
        const type = normalizeFieldType(field.type);
        const label = String(field.label || '').trim().slice(0, REGISTRATION_FORM_LIMITS.maxLabelLength);
        if (!id || !type || !label) continue;
        if (!FIELD_ID_PATTERN.test(id)) continue;
        if (RESERVED_FIELD_IDS.has(id.toLowerCase())) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const normalized = {
            id,
            type,
            label,
            required: field.required === true,
        };

        const placeholder = String(field.placeholder || '').trim().slice(0, REGISTRATION_FORM_LIMITS.maxPlaceholderLength);
        if (placeholder) normalized.placeholder = placeholder;

        if (type === 'select') {
            const options = normalizeOptions(field.options);
            if (options.length === 0) continue;
            normalized.options = options;
        }

        if (type === 'file') {
            if (fileFieldCount >= REGISTRATION_FORM_LIMITS.maxFileFields) continue;
            fileFieldCount += 1;
            const accept = normalizeFileAccept(field.accept);
            if (accept.length > 0) normalized.accept = accept;
        }

        fields.push(normalized);
    }

    if (fields.length === 0) return null;
    return { fields };
}

function isEmptyAnswer(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (typeof value === 'boolean') return value !== true;
    return false;
}

function sanitizeTextAnswer(value, maxLength = REGISTRATION_FORM_LIMITS.maxTextAnswerLength) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
}

function isValidPhone(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return false;
    return /^[+]?[\d\s().-]{6,30}$/.test(trimmed);
}

/**
 * Validate registrationAnswers against the event form schema.
 * @returns {{ valid: boolean, errors: string[], sanitizedAnswers: Record<string, string|boolean|number|null> }}
 */
export function validateRegistrationAnswers(form, answers) {
    const sanitizedAnswers = {};
    const errors = [];

    if (!form?.fields?.length) {
        return { valid: true, errors: [], sanitizedAnswers };
    }

    const answersObj = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
    const allowedIds = new Set(form.fields.map((f) => f.id));

    for (const key of Object.keys(answersObj)) {
        if (!allowedIds.has(key)) {
            errors.push(`Unknown field: ${key}`);
        }
    }

    for (const field of form.fields) {
        const raw = answersObj[field.id];

        if (field.type === 'file') {
            continue;
        }

        if (field.type === 'checkbox') {
            const checked = raw === true || raw === 'true' || raw === 1 || raw === '1';
            if (field.required && !checked) {
                errors.push(`${field.label} is required`);
            }
            sanitizedAnswers[field.id] = checked;
            continue;
        }

        if (field.type === 'number') {
            if (isEmptyAnswer(raw)) {
                if (field.required) errors.push(`${field.label} is required`);
                sanitizedAnswers[field.id] = null;
                continue;
            }
            const num = Number(raw);
            if (!Number.isFinite(num)) {
                errors.push(`${field.label} must be a number`);
                continue;
            }
            sanitizedAnswers[field.id] = num;
            continue;
        }

        const textValue = sanitizeTextAnswer(raw);
        if (!textValue) {
            if (field.required) errors.push(`${field.label} is required`);
            sanitizedAnswers[field.id] = '';
            continue;
        }

        if (field.type === 'phone' && !isValidPhone(textValue)) {
            errors.push(`${field.label} is invalid`);
            continue;
        }

        if (field.type === 'select') {
            if (!field.options.includes(textValue)) {
                errors.push(`${field.label} has an invalid selection`);
                continue;
            }
        }

        sanitizedAnswers[field.id] = textValue;
    }

    return { valid: errors.length === 0, errors, sanitizedAnswers };
}

/**
 * Validate and resolve registration answers for an event (text + file fields).
 * @returns {{ valid: boolean, errors: string[], mergedAnswers: Record<string, unknown>, registrationFileUploads: Array }}
 */
export async function resolveRegistrationAnswersForEvent(event, registrationAnswers, { checkoutMetadata } = {}) {
    const { attachRegistrationFileAnswers } = await import('./registrationFileUpload.js');
    const answersObj =
        registrationAnswers && typeof registrationAnswers === 'object' && !Array.isArray(registrationAnswers)
            ? registrationAnswers
            : {};

    if (!isRegistrationFormSupportedForEvent(event)) {
        if (Object.keys(answersObj).length > 0) {
            return {
                valid: false,
                errors: ['Registration forms are not available for seat-selection events'],
                mergedAnswers: {},
                registrationFileUploads: [],
            };
        }
        return { valid: true, errors: [], mergedAnswers: {}, registrationFileUploads: [] };
    }

    const hasSeatCheckoutPayload =
        (Array.isArray(checkoutMetadata?.placeIds) && checkoutMetadata.placeIds.length > 0) ||
        (Array.isArray(checkoutMetadata?.seatTickets) && checkoutMetadata.seatTickets.length > 0) ||
        (Array.isArray(checkoutMetadata?.sectionSelections) && checkoutMetadata.sectionSelections.length > 0);
    if (hasSeatCheckoutPayload && Object.keys(answersObj).length > 0) {
        return {
            valid: false,
            errors: ['Registration forms are not available for seat-selection checkout'],
            mergedAnswers: {},
            registrationFileUploads: [],
        };
    }

    const registrationForm = getRegistrationFormFromEvent(event);

    if (!registrationForm?.fields?.length) {
        if (Object.keys(answersObj).length > 0) {
            return {
                valid: false,
                errors: ['Registration form not configured for this event'],
                mergedAnswers: {},
                registrationFileUploads: [],
            };
        }
        return { valid: true, errors: [], mergedAnswers: {}, registrationFileUploads: [] };
    }

    const answerValidation = validateRegistrationAnswers(registrationForm, registrationAnswers);
    let fileValidation = { valid: true, errors: [], sanitizedAnswers: {}, uploadsForSync: [] };
    if (answerValidation.valid) {
        fileValidation = await attachRegistrationFileAnswers(
            registrationForm,
            registrationAnswers,
            event._id
        );
    }

    const errors = [...answerValidation.errors, ...fileValidation.errors];
    if (errors.length > 0 && fileValidation.uploadsForSync?.length) {
        const { releaseReservedRegistrationUploads } = await import('./registrationFileUpload.js');
        await releaseReservedRegistrationUploads(fileValidation.uploadsForSync.map((u) => u.uploadId));
    }
    const mergedAnswers = {
        ...answerValidation.sanitizedAnswers,
        ...fileValidation.sanitizedAnswers,
    };

    return {
        valid: errors.length === 0,
        errors,
        mergedAnswers,
        registrationFileUploads: fileValidation.uploadsForSync || [],
    };
}

export function applyRegistrationAnswersToTicketInfo(ticketInfo, mergedAnswers) {
    if (mergedAnswers && Object.keys(mergedAnswers).length > 0) {
        ticketInfo.registrationAnswers = mergedAnswers;
    }
}
