import * as consts from '../const.js';
import * as Audit from '../model/audit.js';
import * as model from '../model/mongoModel.js';
import { error } from '../model/logger.js';

const SENSITIVE_KEYS = new Set([
	'pwd',
	'password',
	'token',
	'accessToken',
	'refreshToken',
	'iv',
	'encryptedData'
]);

const normalizeId = (value) => {
	if (!value) return null;
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (typeof value?.toString === 'function') {
		const asString = value.toString();
		if (asString && asString !== '[object Object]') return asString;
	}
	if (value?.$oid) return String(value.$oid);
	return null;
};

const isObjectIdLike = (value) => /^[a-fA-F0-9]{24}$/.test(String(value || ''));

const redactSensitiveFields = (value) => {
	if (Array.isArray(value)) {
		return value.map(redactSensitiveFields);
	}
	if (!value || typeof value !== 'object') {
		return value;
	}

	const redacted = {};
	Object.entries(value).forEach(([key, nestedValue]) => {
		if (SENSITIVE_KEYS.has(key)) {
			redacted[key] = '[REDACTED]';
			return;
		}
		redacted[key] = redactSensitiveFields(nestedValue);
	});
	return redacted;
};

const getChangedFields = (beforeValue, afterValue) => {
	const before = beforeValue && typeof beforeValue === 'object' ? beforeValue : {};
	const after = afterValue && typeof afterValue === 'object' ? afterValue : {};
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

	const changes = [];
	keys.forEach((key) => {
		if (key === '__v') return;
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
			changes.push(key);
		}
	});
	return changes;
};

const resolveActor = (item) => {
	if (item.user) {
		return { id: normalizeId(item.user._id), name: item.user.name || null };
	}

	const fallbackUserId = normalizeId(item.after?.userId)
		|| normalizeId(item.before?.userId)
		|| normalizeId(item.after?.modifiedBy)
		|| normalizeId(item.before?.modifiedBy);

	if (!fallbackUserId) return null;
	return { id: fallbackUserId, name: null };
};

const mapAuditLog = (item) => {
	const changedFields = getChangedFields(item.before, item.after);
	return {
		id: normalizeId(item._id),
		entityType: item.collectionName,
		entityId: normalizeId(item.documentId),
		action: item.action,
		actor: resolveActor(item),
		before: redactSensitiveFields(item.before),
		after: redactSensitiveFields(item.after),
		changedFields,
		changedSummary: changedFields.slice(0, 4).join(', '),
		createdAt: item.createdAt,
		source: 'mongo'
	};
};

export const getAuditLogs = async (req, res) => {
	try {
		const filters = {
			collectionName: req.query.collectionName,
			documentId: req.query.documentId,
			action: req.query.action,
			userId: req.query.userId,
			includeSystem: req.query.includeSystem,
			from: req.query.from,
			to: req.query.to,
			page: req.query.page,
			limit: req.query.limit
		};

		const { items, pagination } = await Audit.getAuditLogs(filters);
		const mappedLogs = items.map(mapAuditLog);

		const unresolvedActorIds = [
			...new Set(
				mappedLogs
					.filter((log) => log.actor?.id && !log.actor?.name && isObjectIdLike(log.actor.id))
					.map((log) => log.actor.id)
			)
		];

		if (unresolvedActorIds.length > 0) {
			const users = await model.User.find({ _id: { $in: unresolvedActorIds } })
				.select('_id name')
				.lean()
				.exec();
			const userNameById = new Map(users.map((u) => [normalizeId(u._id), u.name]));

			mappedLogs.forEach((log) => {
				if (!log.actor?.id || log.actor?.name) return;
				const resolvedName = userNameById.get(log.actor.id);
				if (resolvedName) {
					log.actor.name = resolvedName;
				}
			});
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			data: mappedLogs,
			pagination
		});
	} catch (err) {
		error('Error fetching audit logs: %s', err.stack || err.message);
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			success: false,
			message: 'Failed to fetch audit logs'
		});
	}
};
