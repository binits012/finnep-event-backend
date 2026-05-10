import { describe, it, expect } from '@jest/globals'
import * as consts from '../../../const.js'
import {
	buildAccessClaims,
	buildCountryMatchFilter,
	canAccessCountry,
	canAccessResource,
	normalizeCountryCode,
	normalizeCountryCodes
} from '../../../util/regionalAccess.js'

describe('regionalAccess', () => {
	it('normalizes supported country names and codes', () => {
		expect(normalizeCountryCode('no')).toBe('NO')
		expect(normalizeCountryCode('Norway')).toBe('NO')
		expect(normalizeCountryCode('Austria')).toBe('AT')
		expect(normalizeCountryCode('United States')).toBe('US')
		expect(normalizeCountryCodes(['finland', 'FI', '', null])).toEqual(['FI'])
	})

	it('treats super admins as global access', () => {
		const claims = buildAccessClaims({
			role: { roleType: consts.ROLE_SUPER_ADMIN },
			scopeType: consts.ACCESS_SCOPE_REGIONAL,
			allowedCountryCodes: ['NO']
		})

		expect(claims).toEqual({
			scopeType: consts.ACCESS_SCOPE_GLOBAL,
			allowedCountryCodes: []
		})
		expect(canAccessCountry({ role: consts.ROLE_SUPER_ADMIN }, 'Finland')).toBe(true)
	})

	it('bridges legacy non-regional tokens without scope as global', () => {
		expect(canAccessCountry({ role: consts.ROLE_ADMIN }, 'Finland')).toBe(true)
		expect(canAccessCountry({ role: consts.ROLE_STAFF }, 'Norway')).toBe(true)
		expect(canAccessCountry({ role: consts.ROLE_REGIONAL_OPS }, 'Norway')).toBe(false)
	})

	it('allows regional users only within assigned countries', () => {
		const auth = {
			role: consts.ROLE_REGIONAL_OPS,
			scopeType: consts.ACCESS_SCOPE_REGIONAL,
			allowedCountryCodes: ['NO']
		}

		expect(canAccessCountry(auth, 'Norway')).toBe(true)
		expect(canAccessCountry(auth, 'FI')).toBe(false)
		expect(canAccessResource(auth, { country: 'NO' })).toBe(true)
		expect(canAccessResource(auth, { country: 'Finland' })).toBe(false)
	})

	it('matches regional access for non-Nordic Stripe countries', () => {
		const auth = {
			role: consts.ROLE_REGIONAL_OPS,
			scopeType: consts.ACCESS_SCOPE_REGIONAL,
			allowedCountryCodes: ['AT', 'US']
		}

		expect(canAccessCountry(auth, 'Austria')).toBe(true)
		expect(canAccessCountry(auth, 'United States')).toBe(true)
		expect(canAccessCountry(auth, 'Germany')).toBe(false)
	})

	it('keeps regionalOps restrictive even when stored scope defaults to global', () => {
		const claims = buildAccessClaims({
			role: { roleType: consts.ROLE_REGIONAL_OPS },
			scopeType: consts.ACCESS_SCOPE_GLOBAL,
			allowedCountryCodes: ['FI']
		})

		expect(claims).toEqual({
			scopeType: consts.ACCESS_SCOPE_REGIONAL,
			allowedCountryCodes: ['FI']
		})
		expect(canAccessCountry({ ...claims, role: consts.ROLE_REGIONAL_OPS }, 'Norway')).toBe(false)
	})

	it('builds Mongo country match filters with aliases', () => {
		const filter = buildCountryMatchFilter(['NO'])

		expect(filter.$in).toHaveLength(2)
		expect(filter.$in.some(regex => regex.test('NO'))).toBe(true)
		expect(filter.$in.some(regex => regex.test('Norway'))).toBe(true)
	})

	it('builds a deny-all filter for explicit empty regional scopes', () => {
		const filter = buildCountryMatchFilter([])

		expect(filter).toEqual({ $in: [] })
	})
})
