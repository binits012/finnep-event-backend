import { describe, expect, it } from '@jest/globals'
import { maskEmailForAudit } from '../../../util/outboundMailLog.js'

describe('maskEmailForAudit', () => {
	it('masks typical emails', () => {
		expect(maskEmailForAudit('alice@example.com')).toBe('al***ce@example.com')
		expect(maskEmailForAudit('ab@x.co')).toBe('a***@x.co')
	})

	it('handles empty / invalid', () => {
		expect(maskEmailForAudit('')).toBe('')
		expect(maskEmailForAudit(null)).toBe('')
		expect(maskEmailForAudit('not-an-email')).toBe('***')
	})
})
