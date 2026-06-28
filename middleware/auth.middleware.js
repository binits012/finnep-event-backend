import * as consts from '../const.js'
import * as jwtToken from '../util/jwtToken.js'

/**
 * Middleware to verify JWT token
 * Extracts user data and attaches to req.user
 */
export const authenticate = async (req, res, next) => {
	const token = req.headers.authorization

	await jwtToken.verifyJWT(token, async (err, data) => {
		if (err || data === null) {
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Unauthorized',
				error: 'INVALID_TOKEN'
			})
		}

		// Attach user data to request
		req.user = data
		next()
	})
}

/**
 * Returns true for admin and superAdmin roles.
 */
export const hasAdminAccess = (role) =>
	role === consts.ROLE_ADMIN || role === consts.ROLE_SUPER_ADMIN

export const hasAccountingAccess = (user) =>
	hasAdminAccess(user?.role) ||
	user?.role === consts.ROLE_ACCOUNTANT ||
	user?.canAccessAccounting === true

/**
 * Middleware to check if user has admin or superadmin role
 * Must be used after authenticate middleware
 */
export const requireAdmin = (req, res, next) => {
	if (!req.user) {
		return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
			message: 'Unauthorized',
			error: 'AUTHENTICATION_REQUIRED'
		})
	}

	if (!hasAdminAccess(req.user.role)) {
		return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
			message: 'Forbidden: Admin access required',
			error: 'INSUFFICIENT_PERMISSIONS'
		})
	}

	next()
}

/**
 * Middleware to check if user has superadmin role only
 * Must be used after authenticate middleware
 */
export const requireSuperAdmin = (req, res, next) => {
	if (!req.user) {
		return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
			message: 'Unauthorized',
			error: 'AUTHENTICATION_REQUIRED'
		})
	}

	if (req.user.role !== consts.ROLE_SUPER_ADMIN) {
		return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
			message: 'Forbidden: SuperAdmin access required',
			error: 'INSUFFICIENT_PERMISSIONS'
		})
	}

	next()
}

/**
 * Middleware for accountant CMS access (accountant role, admin, or canAccessAccounting flag).
 */
export const requireAccountant = (req, res, next) => {
	if (!req.user) {
		return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
			message: 'Unauthorized',
			error: 'AUTHENTICATION_REQUIRED'
		})
	}

	if (!hasAccountingAccess(req.user)) {
		return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
			message: 'Forbidden: Accounting access required',
			error: 'INSUFFICIENT_PERMISSIONS'
		})
	}

	next()
}

/**
 * Combined middleware: authenticate + require admin
 */
export const authenticateAdmin = async (req, res, next) => {
	await authenticate(req, res, (err) => {
		if (err) return next(err)
		requireAdmin(req, res, next)
	})
}

/**
 * Combined middleware: authenticate + require superadmin
 */
export const authenticateSuperAdmin = async (req, res, next) => {
	await authenticate(req, res, (err) => {
		if (err) return next(err)
		requireSuperAdmin(req, res, next)
	})
}

