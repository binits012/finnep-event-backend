import express from 'express'
import {
	resolveSiloBffMerchant,
	partnerFetchForSiloBff,
	proxyFebFrontForSiloBff,
	sendSiloBffError
} from '../util/siloStorefrontBffProxy.js'
import { assertSiloBffOriginAllowed } from '../util/siloBffOriginGuard.js'

const router = express.Router()

router.use((req, res, next) => {
	try {
		assertSiloBffOriginAllowed(req)
		next()
	} catch (error) {
		sendSiloBffError(res, error)
	}
})

async function withMerchant(req, res, handler) {
	try {
		const ctx = await resolveSiloBffMerchant(req)
		await handler(ctx)
	} catch (error) {
		sendSiloBffError(res, error)
	}
}

router.get('/api/merchant', (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, { path: '/partner/v1/merchant' })
		res.json(data)
	})
})

router.get('/api/theme', (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, { path: '/partner/v1/theme' })
		res.json(data)
	})
})

router.get('/api/legal', (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, { path: '/partner/v1/legal' })
		res.json(data)
	})
})

router.get('/api/events', (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, {
			path: '/partner/v1/events',
			searchParams: {
				page: req.query.page || '1',
				limit: req.query.limit || '200',
				city: req.query.city,
				country: req.query.country
			}
		})
		res.json(data)
	})
})

router.get('/api/events/:id', (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, {
			path: `/partner/v1/events/${req.params.id}`,
			searchParams: {
				presale: req.query.presale
			}
		})
		res.json(data)
	})
})

router.post('/api/events/:id/waitlist/send-code', express.json(), (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, {
			path: `/partner/v1/events/${req.params.id}/waitlist/send-code`,
			method: 'POST',
			body: req.body
		})
		res.json(data)
	})
})

router.post('/api/events/:id/waitlist', express.json(), (req, res) => {
	withMerchant(req, res, async ({ credential }) => {
		const data = await partnerFetchForSiloBff(credential, {
			path: `/partner/v1/events/${req.params.id}/waitlist`,
			method: 'POST',
			body: req.body
		})
		res.json(data)
	})
})

router.post('/api/request-data', express.json(), (req, res) => {
	withMerchant(req, res, async () => {
		await proxyFebFrontForSiloBff(req, res, 'request-data')
	})
})

router.use('/api/front', express.json({ limit: '2mb' }), (req, res) => {
	const pathSuffix = req.path.replace(/^\//, '')
	withMerchant(req, res, async ({ merchant }) => {
		await proxyFebFrontForSiloBff(req, res, pathSuffix, { merchant })
	})
})

export default router
