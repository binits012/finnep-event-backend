import express from 'express'
import dotenv from 'dotenv'
dotenv.config()
import cors from 'cors'
//import cookieParser from 'cookie-parser'
import './model/dbConnect.js'
import './util/uploadQueueProcess.js'
import * as adminRole from './util/adminUser.js'
import api from './routes/api.js'
import front from './routes/front.js'
import './util/schedular.js'
import path from 'path'
import Stripe from 'stripe'
import {checkoutSuccess} from './util/paymentActions.js'
const stripe = new Stripe(process.env.STRIPE_KEY)
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
var app = express();
app.use(cors())
app.options('*', cors())
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
            console.log(`⚠️  Webhook signature verification failed.`, err.message);
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

app.use(express.json({ limit: '2gb', extended: false }))
app.use(express.urlencoded({ extended: false }))
//app.use(cookieParser())
app.use('/api', api)
app.use('/front', front)
app.set('port', process.env.PORT || process.env.PORT);

var server = app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + server.address().port);
})
// create remaining roles
adminRole.createRoles()
//add admin role and  user if not present 
adminRole.createAdmin()
// create photoTypes
adminRole.photoTypes()
//create notificationTypes
adminRole.notificationTypes()
//create socialMedia
adminRole.socialMedia()

export default app
