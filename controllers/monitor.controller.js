import * as consts from '../const.js'
import { Ticket, Event } from '../model/mongoModel.js'
import { error } from '../model/logger.js'
import {
	hourBuckets24h,
	velocityLabel,
	window24h,
	window7dEnd,
	windowUpcoming7d
} from '../util/kpiWindows.js'

/** Tickets with isSend still false after this many hours are counted as stuck-send pipeline. */
const ORPHAN_SEND_STUCK_HOURS = 2

export const getMonitorKpis = async (req, res) => {
	try {
		const { start: start24, end: end24 } = window24h()
		const start7 = window7dEnd(end24)
		const { from: upcomingFrom, until: upcomingUntil } = windowUpcoming7d(end24)

		const hourStart = new Date(end24.getTime() - 60 * 60 * 1000)
		const hourPrevStart = new Date(end24.getTime() - 2 * 60 * 60 * 1000)
		const stuckSendBefore = new Date(end24.getTime() - ORPHAN_SEND_STUCK_HOURS * 60 * 60 * 1000)

		const { labels: hourLabels, keys: hourKeys } = hourBuckets24h(start24, end24)

		const [
			ticketAgg24h,
			ticketsCreated7d,
			admissions24h,
			admissionsLastHour,
			admissionsPrevHour,
			paymentMix24,
			paymentMix7d,
			topEvents24h,
			topEvents7d,
			eventRefNullCount,
			staleUnscanned48h,
			stuckSendCount,
			activeEventsCount,
			upcomingEvents7d
		] = await Promise.all([
			Ticket.aggregate([
				{ $match: { createdAt: { $gte: start24, $lte: end24 } } },
				{
					$group: {
						_id: null,
						count: { $sum: 1 },
						free: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'free'] }, 1, 0] } },
						stripe: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'stripe'] }, 1, 0] } },
						paytrail: { $sum: { $cond: [{ $eq: ['$paymentProvider', 'paytrail'] }, 1, 0] } }
					}
				}
			]).exec(),
			Ticket.countDocuments({ createdAt: { $gte: start7, $lte: end24 } }).exec(),
			Ticket.countDocuments({
				isRead: true,
				readAt: { $gte: start24, $lte: end24 }
			}).exec(),
			Ticket.countDocuments({
				isRead: true,
				readAt: { $gte: hourStart, $lte: end24 }
			}).exec(),
			Ticket.countDocuments({
				isRead: true,
				readAt: { $gte: hourPrevStart, $lt: hourStart }
			}).exec(),
			Ticket.aggregate([
				{ $match: { createdAt: { $gte: start24, $lte: end24 } } },
				{ $group: { _id: '$paymentProvider', count: { $sum: 1 } } },
				{ $sort: { count: -1 } }
			]).exec(),
			Ticket.aggregate([
				{ $match: { createdAt: { $gte: start7, $lte: end24 } } },
				{ $group: { _id: '$paymentProvider', count: { $sum: 1 } } },
				{ $sort: { count: -1 } }
			]).exec(),
			Ticket.aggregate([
				{ $match: { createdAt: { $gte: start24, $lte: end24 } } },
				{ $group: { _id: '$event', sold: { $sum: 1 } } },
				{ $sort: { sold: -1 } },
				{ $limit: 8 },
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
						sold: 1,
						title: '$ev.eventTitle',
						status: '$ev.status',
						eventDate: '$ev.eventDate'
					}
				}
			]).exec(),
			Ticket.aggregate([
				{ $match: { createdAt: { $gte: start7, $lte: end24 } } },
				{ $group: { _id: '$event', sold: { $sum: 1 } } },
				{ $sort: { sold: -1 } },
				{ $limit: 8 },
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
						sold: 1,
						title: '$ev.eventTitle',
						status: '$ev.status',
						eventDate: '$ev.eventDate'
					}
				}
			]).exec(),
			Ticket.countDocuments({ event: null }).exec(),
			Ticket.countDocuments({
				active: true,
				isRead: false,
				createdAt: { $lt: new Date(end24.getTime() - 48 * 60 * 60 * 1000) }
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
			}).exec()
		])

		const t24 = ticketAgg24h[0] || {
			count: 0,
			free: 0,
			stripe: 0,
			paytrail: 0
		}

		const avgDaily7d = ticketsCreated7d / 7
		const velocityRatio =
			avgDaily7d > 0 ? t24.count / avgDaily7d : t24.count > 0 ? 1 : 1

		const admissionsAvgPerHour = admissions24h / 24
		const admissionIntensityRatio =
			admissionsAvgPerHour > 0 ? admissionsLastHour / admissionsAvgPerHour : admissionsLastHour

		const ticketsByHour = await Ticket.aggregate([
			{ $match: { createdAt: { $gte: start24, $lte: end24 } } },
			{
				$group: {
					_id: {
						y: { $year: '$createdAt' },
						m: { $month: '$createdAt' },
						d: { $dayOfMonth: '$createdAt' },
						h: { $hour: '$createdAt' }
					},
					c: { $sum: 1 }
				}
			}
		]).exec()

		const hourMap = new Map()
		for (const row of ticketsByHour) {
			const id = row._id
			const d = new Date(id.y, id.m - 1, id.d, id.h, 0, 0, 0)
			hourMap.set(d.getTime(), row.c)
		}
		const ticketsPerHourSeries = hourKeys.map((k) => hourMap.get(k.getTime()) || 0)

		let spotlightEvent = null
		if (topEvents24h?.length && topEvents24h[0].sold > 0) {
			const row = topEvents24h[0]
			spotlightEvent = {
				eventId: row.eventId ? String(row.eventId) : null,
				title: row.title || '—',
				eventDate: row.eventDate || null,
				status: row.status,
				tickets24h: row.sold
			}
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			exportMeta: {
				generatedAt: new Date().toISOString(),
				version: 1,
				timezone: 'UTC',
				source: 'finnep-eventapp-backend',
				window: {
					last24hStart: start24.toISOString(),
					last24hEnd: end24.toISOString(),
					last7dStart: start7.toISOString()
				}
			},
			ticketsCreated24h: t24.count,
			ticketsCreated7d,
			admissions24h,
			admissionsLastHour,
			admissionsPrevHour,
			admissionIntensity: {
				ratio: Math.round(admissionIntensityRatio * 100) / 100,
				baselineAvgPerHour: Math.round(admissionsAvgPerHour * 100) / 100,
				lastHour: admissionsLastHour,
				prevHour: admissionsPrevHour
			},
			velocityVsBaseline: {
				ratio: Math.round(velocityRatio * 100) / 100,
				label: velocityLabel(velocityRatio)
			},
			paymentMix: paymentMix24.map((p) => ({ provider: p._id || 'unknown', count: p.count })),
			paymentMix7d: paymentMix7d.map((p) => ({ provider: p._id || 'unknown', count: p.count })),
			ticketsPerHourSeries,
			ticketsByHour: { labels: hourLabels, values: ticketsPerHourSeries },
			topEventsByTickets7d: topEvents7d,
			topEvents24h,
			activeEventsCount,
			upcomingEvents7d,
			spotlightEvent,
			orphanTickets: {
				stuckSendCount,
				stuckSendOlderThanHours: ORPHAN_SEND_STUCK_HOURS
			},
			baselines: {
				ticketsIssued24h: t24.count,
				admissionsScanned24h: admissions24h,
				liveEvents: activeEventsCount,
				paymentMix24h: {
					free: t24.free,
					stripe: t24.stripe,
					paytrail: t24.paytrail
				}
			},
			dataQuality: {
				ticketsMissingEvent: eventRefNullCount,
				staleUnscannedOlderThan48h: staleUnscanned48h
			}
		})
	} catch (e) {
		error('monitor-kpis failed %s', e.stack)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			message: 'Failed to load monitor KPIs',
			error: e.message
		})
	}
}
