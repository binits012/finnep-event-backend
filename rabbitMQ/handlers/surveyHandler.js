import { Survey } from '../../model/mongoModel.js';
import { error, info } from '../../model/logger.js';

/**
 * Handle survey events (survey.created, survey.updated, survey.deleted) from event-merchant-service.
 * Message payload should include routing_key and survey data (merchant_id, survey_id, name, questions, active, etc.).
 */
export const handleSurveyMessage = async (message) => {
	if (!message || typeof message !== 'object') {
		error('surveyHandler: invalid message format', { message });
		throw new Error('Message must be an object');
	}

	const routingKey = message.routing_key || message.routingKey;
	if (!routingKey) {
		error('surveyHandler: missing routing_key in message', { message });
		throw new Error('Message must include routing_key');
	}

	switch (routingKey) {
		case 'survey.created':
		case 'survey.updated':
			await upsertSurvey(message);
			break;
		case 'survey.deleted':
			await deleteSurvey(message);
			break;
		default:
			info('surveyHandler: ignoring unknown routing_key', { routingKey });
	}
};

async function upsertSurvey(message) {
	const merchantId = message.merchant_id;
	const surveyId = message.survey_id != null ? Number(message.survey_id) : null;
	if (!merchantId || surveyId == null || Number.isNaN(surveyId)) {
		error('surveyHandler: missing or invalid merchant_id/survey_id', { message });
		throw new Error('merchant_id and survey_id required');
	}

	const externalEventId = message.event_id != null && !Number.isNaN(Number(message.event_id)) ? Number(message.event_id) : null;
	await Survey.findOneAndUpdate(
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
	info('surveyHandler: upserted survey', { merchantId, externalSurveyId: surveyId });
}

async function deleteSurvey(message) {
	const merchantId = message.merchant_id;
	const surveyId = message.survey_id != null ? Number(message.survey_id) : null;
	if (!merchantId || surveyId == null || Number.isNaN(surveyId)) {
		error('surveyHandler: missing or invalid merchant_id/survey_id for delete', { message });
		throw new Error('merchant_id and survey_id required');
	}

	const result = await Survey.deleteOne({ merchantId, externalSurveyId: surveyId });
	info('surveyHandler: deleted survey', { merchantId, externalSurveyId: surveyId, deletedCount: result.deletedCount });
}
