import * as jwtToken from '../util/jwtToken.js'
import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import { Ticket, Event } from '../model/mongoModel.js'
import { error } from '../model/logger.js'
import {
	hourBuckets24h,
	velocityLabel,
	window7dEnd,
	windowUpcoming7d
} from '../util/kpiWindows.js'
import {
	dayBucketsUtc,
	parseDashboardRangeQuery,
	pulseGranularity
} from '../util/dashboardRange.js'
import {
	buildBriefFromMetrics,
	filterSummaryPayload,
	parseIncludeQuery,
	roundMoney,
	sortAttentionItems
} from '../util/dashboardSummaryHelpers.js'

/** Same stuck-send window as monitor KPIs. */
const ORPHAN_SEND_STUCK_HOURS = 2

const DISPLAY_CURRENCY = 'EUR'

/** Paid line amount from ticketInfo Map (BSON object). Excludes free at match stage. */
const LINE_PRICE = {
	$toDouble: {
		$ifNull: ['$ticketInfo.totalPrice', { $ifNull: ['$ticketInfo.price', 0] }]
	}
}

const DAY_GROUP_ID = {
	y: { $year: '$createdAt' },
	m: { $month: '$createdAt' },
	d: { $dayOfMonth: '$createdAt' }
}

const HOUR_GROUP_ID = {
	y: { $year: '$createdAt' },
	m: { $month: '$createdAt' },
	d: { $dayOfMonth: '$createdAt' },
	h: { $hour: '$createdAt' }
}

function dayKeyFromParts(id) {
	if (!id) return ''
	return `${id.y}-${String(id.m).padStart(2, '0')}-${String(id.d).padStart(2, '0')}`
}

async function sumPaidRevenueInclusive(rangeStart, rangeEnd) {
	const [row] = await Ticket.aggregate([
		{
			$match: {
				createdAt: { $gte: rangeStart, $lte: rangeEnd },
				paymentProvider: { $ne: 'free' }
			}
		},
		{ $group: { _id: null, total: { $sum: LINE_PRICE }, count: { $sum: 1 } } }
	]).exec()
	return {
		total: roundMoney(row?.total || 0),
		count: row?.count || 0
	}
}

async function sumPaidRevenuePriorPeriod(priorStart, rangeStart) {
	const [row] = await Ticket.aggregate([
		{
			$match: {
				createdAt: { $gte: priorStart, $lt: rangeStart },
				paymentProvider: { $ne: 'free' }
			}
		},
		{ $group: { _id: null, total: { $sum: LINE_PRICE }, count: { $sum: 1 } } }
	]).exec()
	return {
		total: roundMoney(row?.total || 0),
		count: row?.count || 0
	}
}

async function topEventsByRevenueInRange(start, end, limit = 8) {
	return Ticket.aggregate([
		{
			$match: {
				createdAt: { $gte: start, $lte: end },
				paymentProvider: { $ne: 'free' }
			}
		},
		{ $addFields: { lineAmount: LINE_PRICE } },
		{
			$group: {
				_id: '$event',
				revenue: { $sum: '$lineAmount' },
				sold: { $sum: 1 }
			}
		},
		{ $sort: { revenue: -1 } },
		{ $limit: limit },
		{
			$lookup: {
				from: 'events',
				localField: '_id',
				foreignField: '_id',
				as: 'ev'
			}
		},
		{ $unwind: { path: '$ev', preserveNullAndEmptyArrays: true } },
		{
			$project: {
				eventId: '$_id',
				revenue: 1,
				sold: 1,
				title: '$ev.eventTitle',
				status: '$ev.status',
				eventDate: '$ev.eventDate'
			}
		}
	]).exec()
}

async function topEventsByTicketsInRange(start, end, limit = 8) {
	return Ticket.aggregate([
		{ $match: { createdAt: { $gte: start, $lte: end } } },
		{ $group: { _id: '$event', sold: { $sum: 1 } } },
		{ $sort: { sold: -1 } },
		{ $limit: limit },
		{
			$lookup: {
				from: 'events',
				localField: '_id',
				foreignField: '_id',
				as: 'ev'
			}
		},
		{ $unwind: { path: '$ev', preserveNullAndEmptyArrays: true } },
		{
			$project: {
				eventId: '$_id',
				revenue: { $literal: 0 },
				sold: 1,
				title: '$ev.eventTitle',
				status: '$ev.status',
				eventDate: '$ev.eventDate'
			}
		}
	]).exec()
}

function humanPeriodLabel(rangeStart, rangeEnd, mode) {
	if (mode === 'rolling24h') return 'last 24h'
	const ms = rangeEnd.getTime() - rangeStart.getTime()
	const days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)))
	if (days <= 1) return 'selected day'
	return `selected ${days}d window`
}

export async function buildDashboardSummaryPayload(req, rangeResolved) {
	const { rangeStart, rangeEnd, priorStart, mode } = rangeResolved

	const start7 = window7dEnd(rangeEnd)
	const { from: upcomingFrom, until: upcomingUntil } = windowUpcoming7d(rangeEnd)

	const hourStart = new Date(rangeEnd.getTime() - 60 * 60 * 1000)
	const hourPrevStart = new Date(rangeEnd.getTime() - 2 * 60 * 60 * 1000)
	const stuckSendBefore = new Date(rangeEnd.getTime() - ORPHAN_SEND_STUCK_HOURS * 60 * 60 * 1000)

	const durationMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime())
	const durationHours = durationMs / (60 * 60 * 1000)
	const durationDays = durationMs / (24 * 60 * 60 * 1000)

	const gran = pulseGranularity(rangeStart, rangeEnd)
	let hourLabels = []
	let hourKeys = []
	let dayLabels = []
	if (gran === 'hour') {
		const hb = hourBuckets24h(rangeStart, rangeEnd)
		hourLabels = hb.labels
		hourKeys = hb.keys
	} else {
		const db = dayBucketsUtc(rangeStart, rangeEnd)
		dayLabels = db.labels
	}

	let sinceDate = null
	if (req.query?.since) {
		const d = new Date(req.query.since)
		if (!Number.isNaN(d.getTime())) sinceDate = d
	}

	const [
		revCurrent,
		revPrior,
		rev7d,
		ticketAggPeriod,
		ticketsCreated7d,
		admissionsPeriod,
		admissionsLastHour,
		admissionsPrevHour,
		paymentMixPeriod,
		paymentMixPeriodPaid,
		topByRev,
		topByTickets,
		eventRefNullCount,
		staleUnscanned48h,
		stuckSendCount,
		activeEventsCount,
		upcomingEvents7d,
		ticketsPulseRows,
		revenuePulseRows,
		deltaTicketsSince,
		deltaRevenueSince
	] = await Promise.all([
		sumPaidRevenueInclusive(rangeStart, rangeEnd),
		sumPaidRevenuePriorPeriod(priorStart, rangeStart),
		sumPaidRevenueInclusive(start7, rangeEnd),
		Ticket.aggregate([
			{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
			{
				$group: {
					_id: null,
					count: { $sum: 1 },
					free: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'free'] }, 1, 0] } },
					stripe: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'stripe'] }, 1, 0] } },
					paytrail: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'paytrail'] }, 1, 0] } },
					paid: {
						$sum: {
							$cond: [{ $ne: ['$paymentProvider', 'free'] }, 1, 0]
						}
					}
				}
			}
		]).exec(),
		Ticket.countDocuments({ createdAt: { $gte: start7, $lte: rangeEnd } }).exec(),
		Ticket.countDocuments({
			isRead: true,
			readAt: { $gte: rangeStart, $lte: rangeEnd }
		}).exec(),
		Ticket.countDocuments({
			isRead: true,
			readAt: { $gte: hourStart, $lte: rangeEnd }
		}).exec(),
		Ticket.countDocuments({
			isRead: true,
			readAt: { $gte: hourPrevStart, $lt: hourStart }
		}).exec(),
		Ticket.aggregate([
			{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
			{ $group: { _id: '$paymentProvider', count: { $sum: 1 } } },
			{ $sort: { count: -1 } }
		]).exec(),
		Ticket.aggregate([
			{
				$match: {
					createdAt: { $gte: rangeStart, $lte: rangeEnd },
					paymentProvider: { $ne: 'free' }
				}
			},
			{
				$group: {
					_id: '$paymentProvider',
					count: { $sum: 1 },
					amount: { $sum: LINE_PRICE }
				}
			},
			{ $sort: { amount: -1 } }
		]).exec(),
		topEventsByRevenueInRange(rangeStart, rangeEnd),
		topEventsByTicketsInRange(rangeStart, rangeEnd),
		Ticket.countDocuments({ event: null }).exec(),
		Ticket.countDocuments({
			active: true,
			isRead: false,
			createdAt: { $lt: new Date(rangeEnd.getTime() - 48 * 60 * 60 * 1000) }
		}).exec(),
		Ticket.countDocuments({
			isSend: false,
			createdAt: { $lt: stuckSendBefore }
		}).exec(),
		Event.countDocuments({
			active: true,
			status: { $in: ['up-coming', 'on-going'] }
		}).exec(),
		Event.countDocuments({
			active: true,
			eventDate: { $gte: upcomingFrom, $lte: upcomingUntil }
		}).exec(),
		gran === 'hour'
			? Ticket.aggregate([
					{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
					{
						$group: {
							_id: HOUR_GROUP_ID,
							c: { $sum: 1 }
						}
					}
				]).exec()
			: Ticket.aggregate([
					{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
					{
						$group: {
							_id: DAY_GROUP_ID,
							c: { $sum: 1 }
						}
					}
				]).exec(),
		gran === 'hour'
			? Ticket.aggregate([
					{
						$match: {
							createdAt: { $gte: rangeStart, $lte: rangeEnd },
							paymentProvider: { $ne: 'free' }
						}
					},
					{
						$group: {
							_id: HOUR_GROUP_ID,
							revenue: { $sum: LINE_PRICE }
						}
					}
				]).exec()
			: Ticket.aggregate([
					{
						$match: {
							createdAt: { $gte: rangeStart, $lte: rangeEnd },
							paymentProvider: { $ne: 'free' }
						}
					},
					{
						$group: {
							_id: DAY_GROUP_ID,
							revenue: { $sum: LINE_PRICE }
						}
					}
				]).exec(),
		sinceDate
			? Ticket.countDocuments({
					createdAt: { $gte: sinceDate, $lte: rangeEnd }
				}).exec()
			: Promise.resolve(null),
		sinceDate ? sumPaidRevenueInclusive(sinceDate, rangeEnd) : Promise.resolve(null)
	])

	const tPeriod = ticketAggPeriod[0] || {
		count: 0,
		free: 0,
		stripe: 0,
		paytrail: 0,
		paid: 0
	}

	const avgDaily7d = ticketsCreated7d / 7
	const expectedInRangeFrom7d = avgDaily7d * Math.max(durationDays, 1 / 24)
	const velocityRatio =
		expectedInRangeFrom7d > 0
			? tPeriod.count / expectedInRangeFrom7d
			: tPeriod.count > 0
				? 1
				: 1

	const admissionsAvgPerHour = admissionsPeriod / Math.max(durationHours, 1)
	const admissionIntensityRatio =
		admissionsAvgPerHour > 0 ? admissionsLastHour / admissionsAvgPerHour : admissionsLastHour

	let ticketsPerSeries = []
	let revenuePerSeries = []
	let pulseLabels = []
	if (gran === 'hour') {
		const hourMap = new Map()
		for (const row of ticketsPulseRows) {
			const id = row._id
			const d = new Date(id.y, id.m - 1, id.d, id.h, 0, 0, 0)
			hourMap.set(d.getTime(), row.c)
		}
		ticketsPerSeries = hourKeys.map((k) => hourMap.get(k.getTime()) || 0)

		const revHourMap = new Map()
		for (const row of revenuePulseRows) {
			const id = row._id
			const d = new Date(id.y, id.m - 1, id.d, id.h, 0, 0, 0)
			revHourMap.set(d.getTime(), roundMoney(row.revenue || 0))
		}
		revenuePerSeries = hourKeys.map((k) => revHourMap.get(k.getTime()) || 0)
		pulseLabels = hourLabels
	} else {
		const dayMapTickets = new Map()
		for (const row of ticketsPulseRows) {
			dayMapTickets.set(dayKeyFromParts(row._id), row.c)
		}
		ticketsPerSeries = dayLabels.map((label) => dayMapTickets.get(label) || 0)

		const dayMapRev = new Map()
		for (const row of revenuePulseRows) {
			dayMapRev.set(dayKeyFromParts(row._id), roundMoney(row.revenue || 0))
		}
		revenuePerSeries = dayLabels.map((label) => dayMapRev.get(label) || 0)
		pulseLabels = dayLabels
	}

	const avgTicketsPerHour7d = 7 * 24 > 0 ? ticketsCreated7d / (7 * 24) : 0

	let topEvents = topByRev.length ? topByRev : topByTickets
	topEvents = topEvents.map((row) => ({
		eventId: row.eventId ? String(row.eventId) : null,
		title: row.title || '—',
		eventDate: row.eventDate || null,
		status: row.status,
		sold24h: row.sold,
		revenue24h: roundMoney(row.revenue || 0)
	}))

	let spotlight = null
	if (topEvents.length && topEvents[0].sold24h > 0) {
		const row = topEvents[0]
		spotlight = {
			eventId: row.eventId,
			title: row.title,
			eventDate: row.eventDate,
			status: row.status,
			tickets24h: row.sold24h,
			revenue24h: row.revenue24h
		}
	}

	const priorDeltaPct =
		revPrior.total > 0
			? roundMoney(((revCurrent.total - revPrior.total) / revPrior.total) * 100)
			: revCurrent.total > 0
				? 100
				: null

	const revenueDrop = revPrior.total >= 10 && revCurrent.total < revPrior.total * 0.75

	const plab = humanPeriodLabel(rangeStart, rangeEnd, mode)
	const brief = buildBriefFromMetrics(
		{
			revenue24: revCurrent.total,
			revenuePrior24: revPrior.total,
			ticketsIssued24h: tPeriod.count,
			velocityLabel: velocityLabel(velocityRatio),
			topEarnerTitle: spotlight?.title || null,
			admissions24h: admissionsPeriod,
			stuckSendCount
		},
		{
			periodLabel: plab,
			priorPeriodLabel: 'prior period (same length)',
			admissionsLabel: plab
		}
	)

	const attentionRaw = []

	if (stuckSendCount > 0) {
		attentionRaw.push({
			id: 'stuck-send',
			severity: 'critical',
			title: 'Tickets stuck in send pipeline',
			detail: `${stuckSendCount} ticket(s) have isSend=false older than ${ORPHAN_SEND_STUCK_HOURS}h.`,
			hrefSuggestion: '/tickets',
			metric: stuckSendCount,
			sortScore: 100
		})
	}
	if (revenueDrop) {
		attentionRaw.push({
			id: 'revenue-drop-period',
			severity: 'warning',
			title: 'Paid revenue down vs prior period',
			detail: `Gross paid revenue in this window is materially lower than the preceding window of the same length.`,
			hrefSuggestion: '/events',
			metric: priorDeltaPct,
			sortScore: 88
		})
	}
	if (eventRefNullCount > 0) {
		attentionRaw.push({
			id: 'tickets-missing-event',
			severity: 'warning',
			title: 'Tickets missing event reference',
			detail: `${eventRefNullCount} ticket(s) have no linked event.`,
			hrefSuggestion: '/tickets',
			metric: eventRefNullCount,
			sortScore: 62
		})
	}
	if (staleUnscanned48h > 0) {
		attentionRaw.push({
			id: 'stale-unscanned',
			severity: 'info',
			title: 'Older active tickets not scanned',
			detail: `${staleUnscanned48h} active ticket(s) created >48h ago still not scanned.`,
			hrefSuggestion: '/tickets',
			metric: staleUnscanned48h,
			sortScore: 38
		})
	}

	const attention = sortAttentionItems(attentionRaw).map(
		({ sortScore, ...rest }) => rest
	)

	const exportMeta = {
		generatedAt: new Date().toISOString(),
		version: 2,
		schema: 'dashboard.summary.v2',
		timezone: 'UTC',
		source: 'finnep-eventapp-backend',
		reportRange: {
			mode,
			from: rangeStart.toISOString(),
			to: rangeEnd.toISOString(),
			priorFrom: priorStart.toISOString(),
			pulseGranularity: gran
		},
		windows: {
			report: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
			prior: {
				start: priorStart.toISOString(),
				endExclusive: rangeStart.toISOString()
			},
			rolling7dEndingAtReportEnd: {
				start: start7.toISOString(),
				end: rangeEnd.toISOString()
			}
		},
		revenueNote:
			'Gross paid revenue sums ticketInfo.totalPrice (fallback ticketInfo.price) for non-free paymentProvider. Optional query: from & to (ISO 8601) for a custom range; omit for rolling last 24h.'
	}

	const payload = {
		exportMeta,
		revenue: {
			revenueAvailable: true,
			currency: DISPLAY_CURRENCY,
			last24h: revCurrent.total,
			prior24h: revPrior.total,
			last7d: rev7d.total,
			prior24DeltaPct: priorDeltaPct,
			paidOrders24h: revCurrent.count
		},
		brief,
		pulse: {
			label: gran === 'hour' ? 'Sales activity by hour (UTC)' : 'Sales activity by day (UTC)',
			granularity: gran,
			ticketsByHour: { labels: pulseLabels, values: ticketsPerSeries },
			revenueByHour: { labels: pulseLabels, values: revenuePerSeries },
			benchmarkTicketsPerHour7d: roundMoney(avgTicketsPerHour7d)
		},
		kpis: {
			order: [
				'grossPaidRevenue24h',
				'paidOrders24h',
				'ticketsIssued24h',
				'freeTickets24h',
				'admissions24h'
			],
			grossPaidRevenue24h: {
				value: revCurrent.total,
				priorDeltaPct,
				currency: DISPLAY_CURRENCY
			},
			paidOrders24h: { value: tPeriod.paid },
			ticketsIssued24h: { value: tPeriod.count },
			freeTickets24h: { value: tPeriod.free },
			admissions24h: { value: admissionsPeriod }
		},
		paymentMix: {
			last24h: paymentMixPeriod.map((p) => ({
				provider: p._id || 'unknown',
				count: p.count
			})),
			last24hPaidWithAmounts: paymentMixPeriodPaid.map((p) => ({
				provider: p._id || 'unknown',
				count: p.count,
				amount: roundMoney(p.amount || 0)
			}))
		},
		admissions: {
			scanned24h: admissionsPeriod,
			lastHour: admissionsLastHour,
			prevHour: admissionsPrevHour,
			intensityVs24hAvgPerHour: {
				ratio: Math.round(admissionIntensityRatio * 100) / 100,
				baselineAvgPerHour: Math.round(admissionsAvgPerHour * 100) / 100
			}
		},
		velocityVsBaseline: {
			ratio: Math.round(velocityRatio * 100) / 100,
			label: velocityLabel(velocityRatio),
			ticketsCreated7d
		},
		topEvents,
		upcoming: {
			activeEventsCount,
			upcomingEvents7d
		},
		attention,
		dataQuality: {
			ticketsMissingEvent: eventRefNullCount,
			staleUnscannedOlderThan48h: staleUnscanned48h
		},
		spotlight,
		insights: brief.bullets,
		deltaSince:
			sinceDate && deltaTicketsSince != null
				? {
						since: sinceDate.toISOString(),
						ticketsCreated: deltaTicketsSince,
						paidRevenue: deltaRevenueSince.total
					}
				: null
	}

	return payload
}

export const getDashboardSummary = async (req, res) => {
	const token = req.headers.authorization
	await jwtToken.verifyJWT(token, async (err, data) => {
		if (err || data === null) {
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				message: 'Please, provide valid token',
				error: appText.TOKEN_NOT_VALID
			})
		}
		if (consts.ROLE_MEMBER === data.role) {
			return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
				message: 'Sorry, You do not have rights',
				error: appText.INSUFFICENT_ROLE
			})
		}
		const rangeParsed = parseDashboardRangeQuery(req.query)
		if (!rangeParsed.ok) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: rangeParsed.error,
				error: 'INVALID_DATE_RANGE'
			})
		}
		try {
			const payload = await buildDashboardSummaryPayload(req, rangeParsed)
			const includeSet = parseIncludeQuery(req.query?.include)
			const filtered = filterSummaryPayload(payload, includeSet)
			return res.status(consts.HTTP_STATUS_OK).json({ data: filtered })
		} catch (e) {
			error('dashboard-summary failed %s', e.stack)
			return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
				message: 'Failed to load dashboard summary',
				error: e.message
			})
		}
	})
}
