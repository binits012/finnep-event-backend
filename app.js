import express from 'express'
import dotenv from 'dotenv'
dotenv.config()
import cors from 'cors'
import compression from 'compression'
import './model/dbConnect.js'
import './util/uploadQueueProcess.js'
import './workers/emailWorker.js'
import * as adminRole from './util/adminUser.js'
import api from './routes/api.js'
import front from './routes/front.js'
import siloStorefrontBff from './routes/siloStorefrontBff.js'
import {
	SILO_STOREFRONT_BFF_DIRECT_PATH,
	SILO_STOREFRONT_BFF_PUBLIC_PATH
} from './util/siloStorefrontBffProxy.js'
import partner from './routes/partner.js'
//import './util/schedular.js'
import Stripe from 'stripe'
import {checkoutSuccess} from './util/paymentActions.js'
import { handleStripeRefundWebhookEvent } from './util/stripeRefundWebhook.js'
import {
	getStripeWebhookPayload,
	isStripeJsonWebhookRequest,
	resolveStripeWebhookSecrets,
	verifyStripeWebhookEvent,
} from './util/stripeWebhook.js'
import { setupQueues } from './rabbitMQ/services/queueSetup.js';
import { messageConsumer } from './rabbitMQ/services/messageConsumer.js';
import { rabbitMQ } from './util/rabbitmq.js';
import redisClient from './model/redisConnect.js'; // Ensure Redis client is imported early
import { httpMetricsMiddleware } from './util/httpRequestMetrics.js';
import {
  getMergedCorsOrigins,
  isCorsOriginAllowed,
  normalizeCorsOrigin,
  refreshCorsOriginsFromDb,
  refreshPartnerCorsOriginsFromMerchants
} from './util/corsAllowlist.js';
const stripe = new Stripe(process.env.STRIPE_KEY)
const stripeWebhookSecrets = resolveStripeWebhookSecrets()
var app = express();
const rabbitConsumerWatchQueues = ['event-events-queue', 'merchant-events-queue'];

// Add this block right after app initialization to test Redis early
(async () => {
    console.log('Testing Redis connection...');
    console.log('REDIS_HOST:', process.env.REDIS_HOST);
    console.log('REDIS_PORT:', process.env.REDIS_PORT);
    console.log('REDIS_PWD set:', !!process.env.REDIS_PWD);

    try {
        await redisClient.ping(); // Simple ping to test connection
        console.log('Redis connection successful');
    } catch (error) {
        console.error('Redis connection failed:', error.message);
        // Optionally, exit or handle gracefully
        process.exit(1);
    }
})();

// Trace CORS preflight: if this never prints for your curl, the request is not reaching Node (nginx/CDN).
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    console.log('[CORS] OPTIONS inbound', {
      url: req.originalUrl,
      origin: req.headers.origin || '(missing)',
      acrm: req.headers['access-control-request-method'] || '(none)',
      acrh: req.headers['access-control-request-headers'] || '(none)'
    });
  }
  next();
});

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowed = isCorsOriginAllowed(origin);
    if (allowed) {
      callback(null, true);
    } else {
      const normalized = normalizeCorsOrigin(origin);
      const merged = getMergedCorsOrigins();
      console.warn('[CORS] origin denied', {
        origin,
        normalized,
        inListExact: merged.includes(origin),
        inListNormalized: merged.includes(normalized),
        allowlistCount: merged.length
      });
      // `cors` treats the 2nd arg as the allowed origin value; `false` is falsy so it
      // calls next() without running the preflight handler (can surface as nginx 500).
      // Empty array => isOriginAllowed false => preflight ends with no ACAO (browser blocks).
      callback(null, []);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'x-country-code',
    'x-api-key',
    'x-api-secret'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Add security headers that work with frontend CSP
app.use((req, res, next) => {
  // CORS headers are handled by cors() middleware above
  // Don't manually set them here to avoid conflicts

  // Security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Allow the frontend to make requests
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.header('Cross-Origin-Opener-Policy', 'same-origin');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');

  next();
});

// Compression middleware - compresses all responses (gzip/deflate)
// Works alongside Nginx compression in production (double safety net)
app.use(compression({
  level: 6, // Compression level (0-9). 6 is a good balance between speed and compression ratio
  threshold: 10240, // Only compress responses larger than 10KB
  filter: (req, res) => {
    // Skip compression if client explicitly requests it
    if (req.headers['x-no-compression']) {
      return false
    }
    // Use default compression filter (checks Content-Type)
    return compression.filter(req, res)
  }
}))

//app.use(logger('dev'));

// Stripe signature verification must use the raw body (before express.json()).
const stripeWebhookRawParser = express.raw({
	type: (req) => isStripeJsonWebhookRequest(req),
});

app.post('/webhook', stripeWebhookRawParser, async (request, response, next) => {
    if (stripeWebhookSecrets.length === 0 && process.env.NODE_ENV === 'production') {
        console.error(
            'Stripe webhook secrets required in production (STRIPE_WEBHOOK_SECRET and/or STRIPE_CONNECT_WEBHOOK_SECRET)'
        );
        return response.sendStatus(500);
    }

    let event = request.body;
    let webhookSecretLabel = null;

    if (stripeWebhookSecrets.length > 0) {
        try {
            const verified = verifyStripeWebhookEvent(stripe, request, stripeWebhookSecrets);
            event = verified.event;
            webhookSecretLabel = verified.secretLabel;
        } catch (err) {
            console.error('[Stripe webhook] Signature verification failed:', {
                message: err?.message || String(err),
                code: err?.code || undefined,
                configuredSecrets: stripeWebhookSecrets.map((s) => s.label),
                hasRawBody: Boolean(getStripeWebhookPayload(request)),
                contentType: request.headers['content-type'] || null,
                hasSignature: Boolean(request.headers['stripe-signature']),
            });
            return response.status(400).send(`Webhook Error: ${err?.message || 'Invalid signature'}`);
        }
    } else {
        try {
            const payload = getStripeWebhookPayload(request);
            if (payload) {
                event = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
            } else if (typeof request.body === 'object' && request.body !== null) {
                event = request.body;
            } else {
                event = JSON.parse(String(request.body || '{}'));
            }
        } catch (parseErr) {
            console.error('[Stripe webhook] Failed to parse body without verification:', parseErr?.message);
            return response.sendStatus(400);
        }
    }

    if (webhookSecretLabel) {
        console.log('[Stripe webhook] Verified event', {
            type: event?.type,
            id: event?.id,
            account: event?.account || null,
            secretLabel: webhookSecretLabel,
        });
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);
            console.log(event.id)
            // Then define and call a method to handle the successful payment intent.
            // handlePaymentIntentSucceeded(paymentIntent);
            break;
        case 'payment_intent.payment_failed':
            const paymentIntentFailed = event.data.object;
            console.log(event.id)
            console.log("metadata", paymentIntentFailed.metadata)
            console.log('Payment failed:', paymentIntentFailed);
            // Handle the failed payment, e.g., notify the user
            const sessionId = event.data.object.id
            console.log(event.data.object.metadata)
            //const session = await stripe.checkout.sessions.retrieve(sessionId);
            //console.log(session)
            break;
        case 'checkout.session.completed':
            const paymentMetaData = event.data.object.metadata;
            // Then define and call a method to handle the successful attachment of a PaymentMethod.
            // handlePaymentMethodAttached(paymentMethod);
            console.log(event.id)
            await checkoutSuccess(event,paymentMetaData)
            break;
        case 'refund.updated':
        case 'charge.refunded':
            try {
                await handleStripeRefundWebhookEvent(event);
            } catch (refundWebhookErr) {
                console.error('Stripe refund webhook handler failed:', refundWebhookErr);
                return response.sendStatus(500);
            }
            break;
        default:
            // Unexpected event type
            console.log(event.data.object.metadata)
            console.log(`Unhandled event type ${event.type}.`);
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});

app.use(express.json({ limit: '300mb', extended: false }))
app.use(express.urlencoded({ extended: false }))
app.use(httpMetricsMiddleware)
//app.use(cookieParser())

// Swagger API Documentation (optional - only if packages are installed)
// Lazy-load Swagger when route is accessed
let swaggerSetupPromise = null;
const setupSwagger = async () => {
  if (swaggerSetupPromise) return swaggerSetupPromise;

  swaggerSetupPromise = (async () => {
    try {
      const swaggerJsdoc = (await import('swagger-jsdoc')).default;
      const swaggerUi = (await import('swagger-ui-express')).default;
      const swaggerConfig = await import('./config/swagger.js');
      const swaggerSpec = swaggerConfig.swaggerSpec;

      return { swaggerUi, swaggerSpec };
    } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') {
        console.log('Error loading Swagger:', err.message);
      }
      return null;
    }
  })();

  return swaggerSetupPromise;
};

// Swagger UI endpoint
app.use('/api-docs', async (req, res, next) => {
  const swagger = await setupSwagger();
  if (!swagger) {
    return res.status(503).json({
      success: false,
      message: 'Swagger documentation is not available. Install swagger-jsdoc and swagger-ui-express to enable.'
    });
  }
  swagger.swaggerUi.serve(req, res, next);
});

app.get('/api-docs', async (req, res, next) => {
  const swagger = await setupSwagger();
  if (!swagger) {
    return res.status(503).json({
      success: false,
      message: 'Swagger documentation is not available. Install swagger-jsdoc and swagger-ui-express to enable.'
    });
  }
  swagger.swaggerUi.setup(swagger.swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Finnep Event App Backend API'
  })(req, res, next);
});

// OpenAPI JSON endpoint
app.get('/api-docs.json', async (req, res) => {
  const swagger = await setupSwagger();
  if (!swagger) {
    return res.status(503).json({
      success: false,
      message: 'Swagger documentation is not available. Install swagger-jsdoc and swagger-ui-express to enable.'
    });
  }
  res.setHeader('Content-Type', 'application/json');
  res.send(swagger.swaggerSpec);
});

// Try to initialize Swagger on startup (non-blocking)
setupSwagger().then(swagger => {
  if (swagger) {
    console.log('Swagger documentation available at http://localhost:3000/api-docs');
  }
}).catch(() => {
  // Silently fail - Swagger is optional
});

app.use('/api', api)
app.use('/front', front)
app.use(SILO_STOREFRONT_BFF_DIRECT_PATH, siloStorefrontBff)
app.use(SILO_STOREFRONT_BFF_PUBLIC_PATH, siloStorefrontBff)
app.use('/partner/v1', partner)
app.set('port', process.env.PORT || 3000);

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
    var server = app.listen(app.get('port'), async function () {
        console.log('Express server listening on port ' + server.address().port);
    })
    app.locals.server = server
}
// Only run initialization if not in test mode
if (process.env.NODE_ENV !== 'test') {
    // create remaining roles
    await adminRole.createRoles()
    //add admin role and  user if not present
    //await adminRole.createAdmin()
    // create photoTypes
    await adminRole.photoTypes()
    //create notificationTypes
    await adminRole.notificationTypes()
    //create settings
    await adminRole.settings()
    await refreshCorsOriginsFromDb()
    await refreshPartnerCorsOriginsFromMerchants()
    //create socialMedia
    //await adminRole.socialMedia()
}

// Initialize and start queue consumers
let queueWatchdogInterval = null;
let queueWatchdogRunning = false;

try {
    console.log('Initializing RabbitMQ connection...');
    await rabbitMQ.connect();
    console.log('RabbitMQ connected, setting up queues...');
    await setupQueues();
    rabbitMQ.onReconnect(async () => {
        console.log('RabbitMQ reconnected, forcing queue consumer re-setup...');
        await setupQueues(true);
    });
    const queueWatchdogMs = parseInt(process.env.RABBITMQ_QUEUE_WATCHDOG_MS || '30000', 10);
    queueWatchdogInterval = setInterval(async () => {
        if (queueWatchdogRunning) return;
        queueWatchdogRunning = true;
        try {
            const channel = messageConsumer.consumeChannel;
            if (!channel) return;
            const zeroConsumerQueues = [];
            for (const queueName of rabbitConsumerWatchQueues) {
                const queueInfo = await channel.checkQueue(queueName);
                if ((queueInfo?.consumerCount || 0) === 0) {
                    zeroConsumerQueues.push(queueName);
                }
            }
            if (zeroConsumerQueues.length > 0) {
                console.warn('Queue watchdog detected missing consumers, forcing queue setup:', zeroConsumerQueues.join(', '));
                await setupQueues(true);
            }
        } catch (watchdogError) {
            console.error('Queue watchdog error:', watchdogError.message || watchdogError);
        } finally {
            queueWatchdogRunning = false;
        }
    }, queueWatchdogMs);
    console.log('Queue setup completed successfully');
} catch (error) {
    console.error('Failed to setup RabbitMQ/queues:', error.message || error);
    console.log('Application will continue without RabbitMQ functionality');
    // Don't crash the app, just log the error and continue
}

app.get('/health/consumers', async (req, res) => {
    try {
        const channel = messageConsumer.consumeChannel;
        if (!channel) {
            return res.status(503).json({
                status: 'unhealthy',
                reason: 'consume channel not available',
                queues: []
            });
        }

        const queues = [];
        for (const queueName of rabbitConsumerWatchQueues) {
            const queueInfo = await channel.checkQueue(queueName);
            queues.push({
                queue: queueName,
                messages: queueInfo?.messageCount || 0,
                consumers: queueInfo?.consumerCount || 0
            });
        }

        const zeroConsumerQueues = queues.filter((q) => q.consumers === 0).map((q) => q.queue);
        const healthy = zeroConsumerQueues.length === 0;

        return res.status(healthy ? 200 : 503).json({
            status: healthy ? 'healthy' : 'unhealthy',
            zeroConsumerQueues,
            queues
        });
    } catch (healthError) {
        return res.status(503).json({
            status: 'unhealthy',
            reason: healthError.message || 'consumer health check failed'
        });
    }
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    });
    // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    try {
        if (queueWatchdogInterval) {
            clearInterval(queueWatchdogInterval);
            queueWatchdogInterval = null;
        }
        // Close messageConsumer channels if they exist
        if (messageConsumer.publishChannel) {
            await messageConsumer.publishChannel.close();
        }
        if (messageConsumer.consumeChannel) {
            await messageConsumer.consumeChannel.close();
        }
        await rabbitMQ.disconnect();
    } catch (error) {
        console.error('Error during shutdown:', error);
    }
    process.exit(0);
});

// Export app for testing
export { app }
export default app
