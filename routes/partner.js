import * as express from 'express'
const router = express.Router()
import * as partner from '../controllers/partner.controller.js'
import {
	authenticatePartnerApiKey,
	requirePartnerScope
} from '../middleware/apiKey.middleware.js'

router.get('/merchant', authenticatePartnerApiKey, requirePartnerScope('merchant:read'), partner.getPartnerMerchant)
router.get('/theme', authenticatePartnerApiKey, requirePartnerScope('merchant:read'), partner.getPartnerTheme)
router.get('/legal', authenticatePartnerApiKey, requirePartnerScope('merchant:read'), partner.getPartnerLegal)
router.get('/events', authenticatePartnerApiKey, requirePartnerScope('events:read'), partner.listPartnerEvents)
router.get('/events/:id', authenticatePartnerApiKey, requirePartnerScope('events:read'), partner.getPartnerEventById)
router.post('/events/:id/waitlist/send-code', authenticatePartnerApiKey, requirePartnerScope('waitlist:write'), partner.sendPartnerWaitlistCode)
router.post('/events/:id/waitlist', authenticatePartnerApiKey, requirePartnerScope('waitlist:write'), partner.joinPartnerWaitlist)

export default router
