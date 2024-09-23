import * as consts from '../const.js'
import * as  Photo from '../model/photo.js'
import * as  Notification from '../model/notification.js'
import * as  Event from '../model/event.js'
import * as  Setting from '../model/setting.js'
import * as OrderTicket from '../model/orderTicket.js'
import * as hash from '../util/createHash.js'
import { error, info } from '../model/logger.js'
import * as Ticket from '../model/ticket.js'
import crypto from 'crypto'
import { RESOURCE_NOT_FOUND, INTERNAL_SERVER_ERROR } from '../applicationTexts.js'
import * as ticketMaster from '../util/ticketMaster.js'
import * as sendMail from '../util/sendMail.js'
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_KEY)
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET 

export const getDataForFront = async (req, res, next) => {
    const photo = await Photo.listPhoto()
    const notification = await Notification.getAllNotification()
    let event = await Event.getEvents()
    if (event) {
        event = event.filter(e => e.active)
    }
    const setting = await Setting.getSetting()
    const data = {
        photo: photo,
        notification: notification,
        event: event,
        setting: setting
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
}

const createTicketOrder = async (otp, obj) => {
    return await OrderTicket.createOrderTicket(otp, obj)
}

export const createCheckoutSession = async (req, res, next) => {

    const eventName = req.body.eventName
    const eventId = req.body.eventId
    const price = req.body.price
    const quantity = req.body.quantity
    const ticketType = req.body.ticketType
    const totalPrice = req.body.totalPrice
    const email = req.body.email

    //let's do the sanity first, as we can't blindly trust the calculation done from the frontend
    const event = await Event.getEventById(eventId)

    if (!event) {
        error("fishy activity from " + email)
        res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: "what are you tring to do? " });
    } else {
        //given event is found

        const eventPrice = event.ticketInfo.filter(e => ticketType === e.id).map(e => e.price)
        const totalPriceCalculation = eventPrice * quantity

        if (eventPrice !== price && totalPrice !== totalPriceCalculation) {
            error("fishy activity from " + email)
            res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: "what are you tring to do? " });
        } else {
            const emailCrypto = await hash.getCryptoByEmail(email)
            let emailHash = null
            if (emailCrypto.length == 0) {
                //new email which is not yet in the system
                let tempEmailHash = await hash.createHashData(email, 'email')
                emailHash = tempEmailHash._id
            } else {
                emailHash = emailCrypto[0]._id
            }
            const tempTicketOrderObj = {
                eventName: eventName,
                eventId: eventId,
                price: price,
                quantity: quantity,
                ticketType: ticketType,
                totalPrice: totalPrice,
                email: emailHash
            }
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let otp = '';
            for (let i = 0; i < 10; i++) {
                otp += characters.charAt(crypto.randomInt(0, characters.length));
            }
            const ticketOrder = await createTicketOrder(otp, tempTicketOrderObj)
            try {
                const session = await stripe.checkout.sessions.create({

                    payment_method_types: ['card'],
                    mode: 'payment',
                    line_items: [
                        {
                            price_data: {
                                currency: process.env.PAYMENT_CURRENCY,
                                product_data: {
                                    name: eventName,
                                    metadata: {
                                        eventId: eventId,
                                        url: `${req.headers.origin}/events/${eventId}`,
                                        ticketOrderId:ticketOrder.id
                                    }
                                },
                                unit_amount: price * 100, // amount in cents
                            },
                            quantity: quantity,
                        },
                    ],
                    customer_email: email, // Add customer_email parameter
                    success_url: `${req.headers.origin}/success?orderId=${ticketOrder.id}&otp=${otp}`, // Redirect to success page
                    cancel_url: `${req.headers.origin}`,   // Redirect to cancel page
                });

                res.json({ id: session.id });
            } catch (error) {
                if (!res.headersSent) {
                    res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: error.message });
                }

            }
        }
    }


}

export const completeOrderTicket = async (req, res, next) => {
    const orderId = req.body.orderId;
    const otp = req.body.otp;
    let ticketId = null;

    try {
        const orderTicket = await OrderTicket.getOrderTicketById(orderId);

        if (!orderTicket) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR });
        }

        console.log(orderTicket.status);

        // Check if status is already completed or max attempts reached
        if (orderTicket.status === 'completed' || orderTicket.attempts >= 1 || otp !== orderTicket.otp) {
            return res.status(consts.HTTP_STATUS_CONFLICT).send({ error: RESOURCE_ALREADY_EXISTS });
        }

        // Use an atomic operation to update status and prevent race conditions
        const updateResult = await OrderTicket.updateOrderTicketById(orderId, {
            status: 'processing', // temporary status to avoid race conditions
            attempts: orderTicket.attempts + 1
        });

        if (!updateResult) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR });
        }

        const ticketInfo = Object.fromEntries(orderTicket.ticketInfo);

        // Create the ticket
        const ticket = await Ticket.createTicket(null, ticketInfo.email, ticketInfo.eventId, "normal", orderTicket.ticketInfo).catch(err => {
            error('error creating ticket', err.stack);
            throw err;
        });

        ticketId = ticket.id;

        // Process email logic
        const emailCrypto = await hash.readHash(ticketInfo.email);
        const ticketFor = emailCrypto.data;
        const event = await Event.getEventById(ticketInfo.eventId);
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor);

        await new Promise(resolve => setTimeout(resolve, 100)); // intentional delay

        await sendMail.forward(emailPayload).then(async data => {
            // Update the ticket to mark as sent
            const ticketData = await Ticket.updateTicketById(ticket.id, { isSend: true });

            // Mark orderTicket as completed
            await OrderTicket.updateOrderTicketById(orderId, {
                status: 'completed',
                attempts: orderTicket.attempts + 1,
                updatedAt: Date.now(),
                ticket:ticket.id
            });

            return res.status(consts.HTTP_STATUS_CREATED).json({ data: ticketData });

        }).catch(err => {
            error('error forwarding ticket %s', err);
            throw err;
        });

    } catch (err) {
        console.log(err);
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: RESOURCE_NOT_FOUND });
        }
    }
}

