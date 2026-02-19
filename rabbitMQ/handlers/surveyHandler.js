import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Survey } from '../../model/mongoModel.js';
import { error, info } from '../../model/logger.js';
import { messageConsumer } from '../services/messageConsumer.js';

/**
 * Handle survey events (survey.created, survey.updated, survey.deleted) from event-merchant-service.
 * After upsert, publish survey.synced back to event-merchant-service with mongo_survey_id so it can store and use in activity emails.
 */
export const handleSurveyMessage = async (message) => {
	if (!message || typeof message !== 'object') {
		error('surveyHandler: invalid message format', { message });
		throw new Error('Message must be an object');
	}

	// Support both raw payload and wrapped { data } (e.g. from outbox)
	const payload = message.data && typeof message.data === 'object' ? message.data : message;
	const routingKey = payload.routing_key || payload.routingKey || message.routing_key || message.routingKey;
	if (!routingKey) {
		error('surveyHandler: missing routing_key in message', { message });
		throw new Error('Message must include routing_key');
	}

	switch (routingKey) {
		case 'survey.created':
		case 'survey.updated':
			await upsertSurvey(payload);
			break;
		case 'survey.deleted':
			await deleteSurvey(payload);
			break;
		default:
			info('surveyHandler: ignoring unknown routing_key', { routingKey });
	}
};

async function upsertSurvey(message) {
	const merchantId = message.merchant_id;
	const surveyId = message.survey_id != null ? String(message.survey_id) : null;
	if (!merchantId || !surveyId) {
		error('surveyHandler: missing or invalid merchant_id/survey_id', { message });
		throw new Error('merchant_id and survey_id required');
	}

	const externalEventId = message.event_id != null && String(message.event_id).trim() !== '' ? String(message.event_id) : null;
	const doc = await Survey.findOneAndUpdate(
		{ merchantId, externalSurveyId: surveyId },
		{
			merchantId,
			externalSurveyId: surveyId,
			externalEventId,
			name: message.name != null ? message.name : '',
			questions: message.questions != null ? message.questions : [],
			active: message.active !== false,
			updatedAt: new Date()
		},
		{ upsert: true, new: true }
	);
	const mongoSurveyId = doc._id.toString();
	info('surveyHandler: upserted survey', { merchantId, externalSurveyId: surveyId, mongoSurveyId });

	// Round-trip: tell event-merchant-service the Mongo id so it can store and use in event_activity payloads
	const exchangeName = process.env.RABBITMQ_EXCHANGE || 'event-merchant-exchange';
	const messageId = uuidv4();
	await messageConsumer.publishToExchange(exchangeName, 'survey.synced', {
		merchant_id: merchantId,
		survey_id: surveyId,
		event_id: externalEventId ?? null,
		mongo_survey_id: mongoSurveyId
	}, { exchangeType: 'topic', publishOptions: { messageId } });
}

async function deleteSurvey(message) {
	// Coerce to string so query matches MongoDB schema (merchantId/externalSurveyId are String)
	const merchantId = message.merchant_id != null ? String(message.merchant_id) : null;
	const surveyId = message.survey_id != null ? String(message.survey_id) : null;
	const mongoSurveyId = message.mongo_survey_id != null ? String(message.mongo_survey_id).trim() : null;
	if (!merchantId || !surveyId) {
		error('surveyHandler: missing or invalid merchant_id/survey_id for delete', { message });
		throw new Error('merchant_id and survey_id required');
	}
	let result;
	if (mongoSurveyId && /^[a-fA-F0-9]{24}$/.test(mongoSurveyId)) {
		result = await Survey.deleteOne({ _id: new mongoose.Types.ObjectId(mongoSurveyId) });
	} else {
		result = await Survey.deleteOne({ merchantId, externalSurveyId: surveyId });
	}
	info('surveyHandler: deleted survey', { merchantId, externalSurveyId: surveyId, mongoSurveyId: mongoSurveyId || undefined, deletedCount: result.deletedCount });
}
