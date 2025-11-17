 export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_CREATED = 201;
export const HTTP_STATUS_ACCEPTED = 202;
export const HTTP_STATUS_NO_CONTENT = 204;
export const HTTP_STATUS_REDIRECT = 302;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_SERVICE_UNAUTHORIZED = 401;
export const HTTP_STATUS_SERVICE_FORBIDDEN = 403;
export const HTTP_STATUS_RESOURCE_NOT_FOUND = 404;
export const HTTP_STATUS_CONFLICT = 409;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
export const HTTP_STATUS_NOT_IMPLEMENTED = 501;
export const HTTP_STATUS_SERVICE_UNAVAILABLE = 505;

export const HTTP_CLIENT_CALLBACK = '/';
export const HTTP_HEADER_ORIGIN = 'Origin';

export const ROLE_SUPER_ADMIN = 'superAdmin';
export const ROLE_ADMIN = 'admin';
export const ROLE_STAFF = 'staff';
export const ROLE_MEMBER = 'member';

export const PHOTO_TYPES_GALLERY = "Gallery";
export const PHOTO_TYPES_FOOD = "Event";
export const PHOTO_TYPES_OTHER = "Other";

export const CONTACT_TYPE_EMAIL = "email";
export const CONTACT_TYPE_PHONE = "phone";

export const PHOTO_ARRIVAL_QUEUE = "PHOTO_ARRIVAL_QUEUE";
export const SEND_SINGLE_TICKET_QUEUE = "SEND_SINGLE_TICKET_QUEUE";
export const CREATE_TICKET_FROM_FILE_UPLOAD = "CREATE_TICKET_FROM_FILE_UPLOAD";

// File upload constants
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
export const ALLOWED_RESUME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// CloudFront and caching constants
export const CLOUDFRONT_URL_EXPIRY_DAYS = 29;
export const CLOUDFRONT_URL_EXPIRY_SECONDS = CLOUDFRONT_URL_EXPIRY_DAYS * 24 * 60 * 60;

// Redis cache constants
export const SETTINGS_CACHE_KEY = 'settings:all';
export const SETTINGS_CACHE_TTL = 3600; // 1 hour in seconds

// Request validation constants
export const MAX_REQUEST_SIZE = 20 * 1024; // 20KB limit
export const MAX_STRING_LENGTH = 255;
export const MAX_EVENT_ID_LENGTH = 50;
export const MAX_EMAIL_LENGTH = 100;
export const MAX_EVENT_NAME_LENGTH = 200;
export const MAX_TICKET_NAME_LENGTH = 100;
export const MAX_COUNTRY_LENGTH = 50;
export const MAX_QUANTITY_LENGTH = 10;

// Payment validation constants
export const MIN_AMOUNT = 1; // 1 cent
export const MAX_AMOUNT = 10000000; // 100,000.00 in cents
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 100;
export const PRICE_TOLERANCE = 0.01;
export const STRIPE_TIMEOUT_MS = 10000; // 10 seconds

// OTP generation constants
export const OTP_LENGTH = 10;
export const OTP_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';

// Pagination constants
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 10000;
export const MIN_PAGE = 1;
export const MIN_LIMIT = 1;

