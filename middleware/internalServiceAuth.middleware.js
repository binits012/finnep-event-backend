import crypto from 'crypto';
import * as consts from '../const.js';

const timingSafeEqualStrings = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};

export const authenticateInternalService = (req, res, next) => {
    const expected = process.env.FEB_INTERNAL_SERVICE_TOKEN;
    if (!expected) {
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            error: 'Internal service auth is not configured'
        });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.headers['x-service-token'];

    if (!token || !timingSafeEqualStrings(String(token), String(expected))) {
        return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
            success: false,
            error: 'Unauthorized'
        });
    }

    return next();
};
