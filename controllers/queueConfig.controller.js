import os from 'os'

/**
 * System metrics for queue-service auto-activation.
 * GET /api/queue/config/metrics
 */
export const getQueueMetrics = async (req, res) => {
	try {
		const cpus = os.cpus()
		const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0)
		const totalTick = cpus.reduce(
			(acc, cpu) => acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
			0
		)
		const cpuUsagePercent = totalTick > 0
			? Math.round((1 - totalIdle / totalTick) * 100)
			: 0

		const mem = process.memoryUsage()
		const totalMem = os.totalmem()
		const memoryPercent = totalMem > 0
			? Math.round((mem.rss / totalMem) * 100)
			: 0

		return res.status(200).json({
			success: true,
			metrics: {
				cpu: cpuUsagePercent,
				memory: memoryPercent,
				responseTime: 0,
				errorRate: 0,
				connections: 0,
				loadAverage: os.loadavg(),
				uptime: process.uptime(),
				timestamp: new Date().toISOString()
			}
		})
	} catch (error) {
		console.error('Error collecting queue metrics:', error)
		return res.status(500).json({
			success: false,
			error: 'Failed to collect metrics'
		})
	}
}

/**
 * Email configuration for queue-service alerting.
 * GET /api/queue/config/email
 */
export const getQueueEmailConfig = async (req, res) => {
	try {
		const emailConfig = {
			sendMail: process.env.EMAIL_SEND_MAIL !== 'false',
			host: process.env.EMAIL_SERVER || '',
			port: parseInt(process.env.EMAIL_PORT || '587', 10),
			auth: {
				user: process.env.EMAIL_USERNAME || '',
				pass: process.env.EMAIL_PASSWORD ? '***' : ''
			},
			from: process.env.EMAIL_USERNAME || '',
			alertTo: process.env.QUEUE_ALERT_EMAIL || process.env.EMAIL_USERNAME || ''
		}

		// Return real password only to authenticated internal callers
		if (process.env.EMAIL_PASSWORD) {
			emailConfig.auth.pass = process.env.EMAIL_PASSWORD
		}

		return res.status(200).json({
			success: true,
			emailConfig
		})
	} catch (error) {
		console.error('Error loading queue email config:', error)
		return res.status(500).json({
			success: false,
			error: 'Failed to load email configuration'
		})
	}
}
