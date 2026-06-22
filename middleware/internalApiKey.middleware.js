/**
 * Authenticate internal service-to-service requests via X-API-Key header.
 * Used by queue-service and other internal microservices.
 */
export const authenticateInternalApiKey = (req, res, next) => {
	const apiKey = req.headers['x-api-key']
	const expectedKey = process.env.INTERNAL_API_KEY || 'internal-queue-service-key'

	if (!apiKey) {
		return res.status(401).json({
			success: false,
			error: 'Missing API key',
			message: 'X-API-Key header is required'
		})
	}

	if (apiKey !== expectedKey) {
		return res.status(401).json({
			success: false,
			error: 'Unauthorized',
			message: 'Invalid internal API key'
		})
	}

	next()
}

export default authenticateInternalApiKey
