import express from 'express'
import dotenv from 'dotenv'
dotenv.config()
import cors from 'cors'
import compression from 'compression'
import './model/dbConnect.js'
import './util/uploadQueueProcess.js'
import * as adminRole from './util/adminUser.js'
import api from './routes/api.js'
import front from './routes/front.js'
import './util/schedular.js'
import Stripe from 'stripe'
import {checkoutSuccess} from './util/paymentActions.js'
import { setupQueues } from './rabbitMQ/services/queueSetup.js';
import { messageConsumer } from './rabbitMQ/services/messageConsumer.js';
import { rabbitMQ } from './util/rabbitmq.js';
import redisClient from './model/redisConnect.js'; // Ensure Redis client is imported early
const stripe = new Stripe(process.env.STRIPE_KEY)
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
var app = express();

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

// Configure CORS to work with frontend CSP
const corsOptions = {
  origin: [
    'http://localhost:3002',
    'http://localhost:3000',
    'http://localhost:3003',
    'https://eventapp.finnep.fi',
    'https://finnep.fi',
    'https://cms.eventapp.finnep.fi',
    'http://192.168.1.117:3003',
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Add security headers that work with frontend CSP
app.use((req, res, next) => {
  // Allow frontend to connect to this API
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');

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

app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response, next) => {
    let event = request.body;
    // Only verify the event if you have an endpoint secret defined.
    // Otherwise use the basic event deserialized with JSON.parse
    if (endpointSecret) {
        // Get the signature sent by Stripe
        const signature = request.headers['stripe-signature'];
        try {
            event = stripe.webhooks.constructEvent(
                request.body,
                signature,
                endpointSecret
            );
        } catch (err) {
            return response.sendStatus(400);
        }
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
app.set('port', process.env.PORT || process.env.PORT);

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
    var server = app.listen(app.get('port'), async function () {
        console.log('Express server listening on port ' + server.address().port);
    })
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
    //create socialMedia
    //await adminRole.socialMedia()
}

// Initialize and start queue consumers
try {
    console.log('Initializing RabbitMQ connection...');
    await rabbitMQ.connect();
    console.log('RabbitMQ connected, setting up queues...');
    await setupQueues();
    console.log('Queue setup completed successfully');
} catch (error) {
    console.error('Failed to setup RabbitMQ/queues:', error.message || error);
    console.log('Application will continue without RabbitMQ functionality');
    // Don't crash the app, just log the error and continue
}

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
