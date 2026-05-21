import * as model from './mongoModel.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const toPositiveInt = (value, fallback) => {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
	}
	return parsed;
};

const toDateOrNull = (value) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const buildAuditQuery = (filters = {}) => {
	const query = {};

	if (filters.collectionName) {
		query.collectionName = String(filters.collectionName).trim();
	}
	if (filters.documentId) {
		query.documentId = String(filters.documentId).trim();
	}
	if (filters.action) {
		query.action = String(filters.action).trim();
	}
	if (filters.userId) {
		query.user = String(filters.userId).trim();
	}

	if (filters.from || filters.to) {
		const fromDate = toDateOrNull(filters.from);
		const toDate = toDateOrNull(filters.to);
		if (fromDate || toDate) {
			query.createdAt = {};
			if (fromDate) {
				query.createdAt.$gte = fromDate;
			}
			if (toDate) {
				query.createdAt.$lte = toDate;
			}
		}
	}

	return query;
};

export const getAuditLogs = async (filters = {}) => {
	const page = toPositiveInt(filters.page, 1);
	const limit = Math.min(toPositiveInt(filters.limit, DEFAULT_LIMIT), MAX_LIMIT);
	const skip = (page - 1) * limit;

	const query = buildAuditQuery(filters);

	const [items, total] = await Promise.all([
		model.AuditTrail.find(query)
			.populate('user', 'name')
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.lean()
			.exec(),
		model.AuditTrail.countDocuments(query)
	]);

	return {
		items,
		pagination: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit) || 1
		}
	};
};
