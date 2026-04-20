import os from 'os';
import * as consts from '../const.js';
import * as appText from '../applicationTexts.js';
import { getHttpMetricsSnapshot } from './httpRequestMetrics.js';

// Cache for calculating CPU usage delta
let lastCpuUsage = null;
let lastCheckTime = null;
/**
 * Calculate CPU usage percentage based on delta
 */
const getCpuUsage = () => {
	const currentUsage = process.cpuUsage();
	const currentTime = Date.now();

	if (!lastCpuUsage || !lastCheckTime) {
		lastCpuUsage = currentUsage;
		lastCheckTime = currentTime;
		return 0;
	}

	const timeDelta = (currentTime - lastCheckTime) / 1000;
	const userDelta = (currentUsage.user - lastCpuUsage.user) / 1000000;
	const systemDelta = (currentUsage.system - lastCpuUsage.system) / 1000000;

	lastCpuUsage = currentUsage;
	lastCheckTime = currentTime;

	const cpuPercent = ((userDelta + systemDelta) / timeDelta) * 100;
	return Math.min(Math.max(cpuPercent, 0), 100);
};

/**
 * Get active connection count (requires server instance)
 * Pass your HTTP server instance to track real connections
 */
const getActiveConnections = (server) => {
	return new Promise((resolve) => {
		if (!server || typeof server.getConnections !== 'function') {
			resolve(0);
			return;
		}

		server.getConnections((err, count) => {
			resolve(err ? 0 : count);
		});
	});
};

export const getSystemMetrics = async (req, res, next) => {
	try {
		const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
		const expectedKey = process.env.INTERNAL_API_KEY || 'internal-queue-service-key';

		if (!apiKey || apiKey !== expectedKey) {
			return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
				success: false,
				message: 'Unauthorized - Invalid internal API key',
				error: 'INVALID_API_KEY'
			});
		}

		const metrics = {
			cpu: 0,
			memory: 0,
			responseTime: 0,
			errorRate: 0,
			connections: 0,
			loadAverage: [0, 0, 0],
			loadPerCore: 0
		};

		// CPU usage - accurate delta calculation
		metrics.cpu = parseFloat(getCpuUsage().toFixed(2));

		// Memory usage - system agnostic calculation
		// Uses actual memory pressure, not just free memory (which varies by OS caching strategy)
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;

		// For macOS/Linux: Consider memory pressure, not just free memory
		// Memory is "actually used" when it exceeds reasonable cache levels
		const platform = os.platform();
		let actualMemoryPercent;

		if (platform === 'darwin' || platform === 'linux') {
			// On Unix systems, consider memory used when > 50% is non-free
			// This accounts for OS caching strategies
			const processMemory = process.memoryUsage().rss;
			const activeMemory = totalMem - freeMem;

			// If free memory is less than 10% of total, use traditional calculation
			// Otherwise, use process memory usage which is more accurate
			if (freeMem < totalMem * 0.1) {
				actualMemoryPercent = (activeMemory / totalMem) * 100;
			} else {
				// System has plenty of free memory, report based on active processes
				actualMemoryPercent = Math.min(((activeMemory - (freeMem * 0.5)) / totalMem) * 100, 100);
			}
		} else {
			// Windows: traditional calculation works fine
			actualMemoryPercent = (usedMem / totalMem) * 100;
		}

		metrics.memory = parseFloat(Math.max(actualMemoryPercent, 0).toFixed(2));

		// System load average
		metrics.loadAverage = os.loadavg().map(v => parseFloat(v.toFixed(2)));

		const numCpus = Math.max(1, os.cpus().length);
		metrics.loadPerCore = parseFloat((metrics.loadAverage[0] / numCpus).toFixed(4));

		// Get actual active connections (requires app.locals.server set after listen)
		metrics.connections = await getActiveConnections(req.app.locals.server);

		// Real HTTP latency & error % from rolling window (see httpRequestMetrics.js)
		const http = getHttpMetricsSnapshot();
		if (http.sampleCount > 0) {
			metrics.responseTime = parseFloat(http.avgResponseTime.toFixed(2));
			metrics.errorRate = parseFloat(http.errorRate.toFixed(4));
		} else {
			// No samples yet (cold start): expose resource-derived estimates so queue can still react to CPU/mem/load
			const normalizedLoad = metrics.loadPerCore;
			const cpuPressure = metrics.cpu / 100;
			const memPressure = Math.min(metrics.memory / 80, 1);
			const loadPressure = Math.min(normalizedLoad, 1);
			const resourcePressure = (cpuPressure * 0.35) + (memPressure * 0.35) + (loadPressure * 0.30);
			metrics.responseTime = parseFloat((50 + (resourcePressure * 4950)).toFixed(2));
			const errorPressure = Math.max(0, resourcePressure - 0.5) / 0.5;
			metrics.errorRate = parseFloat((0.01 + (Math.pow(errorPressure, 2) * 9.99)).toFixed(4));
		}

		res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			metrics,
			timestamp: new Date().toISOString(),
			source: 'backend-application'
		});
	} catch (error) {
		console.error('Error getting system metrics:', error);
		res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			success: false,
			message: 'Failed to retrieve system metrics',
			error: appText.INTERNAL_SERVER_ERROR
		});
	}
};