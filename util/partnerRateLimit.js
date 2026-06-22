import redisClient from '../model/redisConnect.js'

const DEFAULT_WINDOW_SECONDS = parseInt(process.env.PARTNER_API_RATE_LIMIT_WINDOW_SEC || '60', 10)
const DEFAULT_MAX_REQUESTS = parseInt(process.env.PARTNER_API_RATE_LIMIT_MAX || '120', 10)

const memoryBuckets = new Map()

function checkMemoryRateLimit(key) {
	const now = Date.now()
	const windowMs = DEFAULT_WINDOW_SECONDS * 1000
	const bucket = memoryBuckets.get(key)
	if (!bucket || now >= bucket.resetAt) {
		memoryBuckets.set(key, { count: 1, resetAt: now + windowMs })
		return { allowed: true, retryAfterSeconds: 0 }
	}
	bucket.count += 1
	if (bucket.count > DEFAULT_MAX_REQUESTS) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1)
		}
	}
	return { allowed: true, retryAfterSeconds: 0 }
}

export async function checkPartnerRateLimit(keyId) {
	const redisKey = `partner_api_rl:${keyId}`
	try {
		const count = await redisClient.incr(redisKey)
		if (count === 1) {
			await redisClient.expire(redisKey, DEFAULT_WINDOW_SECONDS)
		}
		if (count > DEFAULT_MAX_REQUESTS) {
			const ttl = await redisClient.ttl(redisKey)
			return {
				allowed: false,
				retryAfterSeconds: ttl > 0 ? ttl : DEFAULT_WINDOW_SECONDS
			}
		}
		return { allowed: true, retryAfterSeconds: 0 }
	} catch {
		return checkMemoryRateLimit(keyId)
	}
}
