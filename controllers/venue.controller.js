import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import { Venue } from '../model/mongoModel.js'
import * as common from '../util/common.js'
import { error } from '../model/logger.js'

/**
 * Create a new venue
 */
export const createVenue = async (req, res, next) => {
	try {
		const venueData = req.body
		const venue = new Venue(venueData)
		const savedVenue = await venue.save()
		return res.status(consts.HTTP_STATUS_OK).json({ data: savedVenue })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get all venues with optional filters, search, and pagination
 */
export const getVenues = async (req, res, next) => {
	try {
		const {
			merchant,
			search,
			country,
			city,
			state,
			page = 1,
			limit = 10
		} = req.query

		const query = {}

		if (merchant) {
			query.merchant = merchant
		}

		// Location-based filters
		if (country) {
			query.country = { $regex: country.trim(), $options: 'i' }
		}

		if (city) {
			query.city = { $regex: city.trim(), $options: 'i' }
		}

		if (state) {
			query.state = { $regex: state.trim(), $options: 'i' }
		}

		// Search by name, address, city, or description (case-insensitive)
		if (search && search.trim()) {
			const searchRegex = { $regex: search.trim(), $options: 'i' }
			query.$or = [
				{ name: searchRegex },
				{ address: searchRegex },
				{ city: searchRegex },
				{ description: searchRegex }
			]
		}

		// Calculate pagination
		const pageNum = Math.max(1, parseInt(page, 10) || 1)
		const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
		const skip = (pageNum - 1) * limitNum

		// Get total count for pagination
		const total = await Venue.countDocuments(query)

		const venues = await Venue.find(query)
			.populate('merchant')
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limitNum)

		return res.status(consts.HTTP_STATUS_OK).json({
			data: venues,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
				hasMore: pageNum * limitNum < total
			}
		})
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get venue by ID
 */
export const getVenueById = async (req, res, next) => {
	try {
		const { id } = req.params

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const venue = await Venue.findById(id).populate('merchant')
		if (!venue) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: venue })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Update venue
 */
export const updateVenueById = async (req, res, next) => {
	try {
		const { id } = req.params
		const updateData = req.body

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		updateData.updatedAt = new Date()

		const venue = await Venue.findByIdAndUpdate(
			id,
			{ $set: updateData },
			{ new: true, runValidators: true }
		).populate('merchant')

		if (!venue) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: venue })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Delete venue
 */
export const deleteVenueById = async (req, res, next) => {
	try {
		const { id } = req.params

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid ID',
				error: appText.INVALID_ID
			})
		}

		const venue = await Venue.findByIdAndDelete(id)
		if (!venue) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Venue deleted successfully',
			data: venue
		})
	} catch (err) {
		error('error', err)
		next(err)
	}
}

/**
 * Get venues for a specific merchant (merchant-specific endpoint)
 * Allows merchants to access venues associated with their merchant ID
 * Supports both MongoDB ObjectId and external merchant ID (numeric string)
 */
export const getVenuesByMerchant = async (req, res, next) => {
	try {
		const token = req.headers.authorization
		const { merchantId } = req.params

		if (!token) {
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Please, provide valid token',
				error: appText.TOKEN_NOT_VALID
			})
		}

		// Verify JWT token
		const jwtToken = await import('../util/jwtToken.js')
		const Merchant = (await import('../model/merchant.js')).default

		await jwtToken.verifyJWT(token, async (err, data) => {
			if (err || data === null) {
				return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
					message: 'Please, provide valid token',
					error: appText.TOKEN_NOT_VALID
				})
			}

			try {
				// Build query - filter by merchant ID
				const query = {}
				const mongoose = (await import('mongoose')).default

				if (merchantId) {
					// Check if merchantId is a MongoDB ObjectId (24 hex characters)
					if (mongoose.Types.ObjectId.isValid(merchantId) && merchantId.length === 24) {
						// It's a MongoDB ObjectId
						query.merchant = new mongoose.Types.ObjectId(merchantId)
					} else if (/^\d+$/.test(merchantId)) {
						// It's a numeric string (external merchant ID)
						// Look up the merchant by external merchant ID to get MongoDB ObjectId
						const merchant = await Merchant.getMerchantByMerchantId(merchantId)
						if (merchant && merchant._id) {
							query.merchant = merchant._id
						} else {
							// Merchant not found, return empty array
							return res.status(consts.HTTP_STATUS_OK).json({ data: [] })
						}
					} else {
						// Invalid format
						return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
							message: 'Invalid merchant ID format',
							error: appText.INVALID_ID
						})
					}
				}

				const venues = await Venue.find(query)
					.populate('merchant')
					.sort({ createdAt: -1 })
					.select('_id name venueType externalVenueId merchant address city state country postalCode coordinates timezone phone email website description createdAt updatedAt')

				return res.status(consts.HTTP_STATUS_OK).json({ data: venues })
			} catch (err) {
				error('Error fetching venues by merchant:', err)
				next(err)
			}
		})
	} catch (err) {
		error('Error in getVenuesByMerchant:', err)
		next(err)
	}
}

/**
 * Update venue sections configuration
 * Also accepts backgroundSvg updates for convenience
 */
export const updateVenueSections = async (req, res, next) => {
	try {
		const { id } = req.params
		const { sections, centralFeature, backgroundSvg } = req.body

		if (!common.validateParam(id)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid venue ID',
				error: appText.INVALID_ID
			})
		}

		const updateData = {
			updatedAt: new Date()
		}

		if (sections !== undefined) {
			updateData.sections = sections
		}

		if (centralFeature !== undefined) {
			updateData.centralFeature = centralFeature
		}

		if (backgroundSvg !== undefined) {
			updateData.backgroundSvg = backgroundSvg
		}

		const venue = await Venue.findByIdAndUpdate(
			id,
			{ $set: updateData },
			{ new: true, runValidators: true }
		).populate('merchant')

		if (!venue) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue not found',
				error: appText.RESOURCE_NOT_FOUND
			})
		}

		return res.status(consts.HTTP_STATUS_OK).json({ data: venue })
	} catch (err) {
		error('error', err)
		next(err)
	}
}

