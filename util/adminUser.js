import * as Role from '../model/role.js'
import * as User from '../model/users.js'
import * as PhotoType from '../model/photoType.js'
import * as NotificationType from '../model/notificationType.js'
import * as SocialMedia from '../model/socialMedia.js'
import * as Setting from '../model/setting.js'
import * as consts from '../const.js'
import * as logger from '../model/logger.js'
import dotenv from 'dotenv'
dotenv.config()
export const createAdmin = async () => {

    try {
        await Role.createRole(consts.ROLE_SUPER_ADMIN)
        const adminRole = await Role.getRoleByRoleType(consts.ROLE_SUPER_ADMIN)
        await User.createUser(process.env.ADMIN_USER, process.env.ADMIN_PWD,
            adminRole._id, true, false)
    } catch (e) {
        //something went wrong roll back
        logger.error('error on admin %s',e.stack)
        await Role.deleteRole(consts.ROLE_SUPER_ADMIN)
        await User.deleteUserByname(consts.ROLE_SUPER_ADMIN)
    }
}

export const createRoles = async () => {
    const adminRole = await Role.getRoleByRoleType(consts.ROLE_ADMIN)
    const staffRole = await Role.getRoleByRoleType(consts.ROLE_STAFF)
    const customerRole = await Role.getRoleByRoleType(consts.ROLE_MEMBER)
    if (!adminRole && !staffRole && !customerRole) {
        try {
            await Role.createRole(consts.ROLE_ADMIN)
            await Role.createRole(consts.ROLE_STAFF)
            await Role.createRole(consts.ROLE_MEMBER)
            await createAdmin();
        } catch (error) {
            logger.error('error on roles %s ',error.stack)
            await Role.deleteRole(consts.ROLE_ADMIN)
            await Role.deleteRole(consts.ROLE_STAFF)
            await Role.deleteRole(consts.ROLE_MEMBER)
        }
    }
}


export const photoTypes = async () => {
    const photoType= await PhotoType.getPhotoTypes()
    if(photoType.length ===  0){

        try{
            await PhotoType.createPhotoType("Gallery")
            await PhotoType.createPhotoType("Other")
        }catch (err){
            console.log(err)
            logger.error('error on photoType %s',err.stack)
        }
    }
}

export const notificationTypes = async () =>{
    const notificationTypes = await NotificationType.getNotificationTypes()
    if(notificationTypes.length === 0){
        try{
            await NotificationType.createNotificationType("marquee")
            await NotificationType.createNotificationType("in-between")
            await NotificationType.createNotificationType("pop-over")
            await NotificationType.createNotificationType("footer-based")
        }catch(err){
            logger.error('error on notificationType %s ',err.stack)
        }
    }
}

export const socialMedia = async () =>{
    const socialMedia = await SocialMedia.getAllSocialMedia()
    if(socialMedia.length === 0){
        try{
            await SocialMedia.createSocialMedia("Facebook")
            await SocialMedia.createSocialMedia("Twitter")
            await SocialMedia.createSocialMedia("Instagram")
            await SocialMedia.createSocialMedia("Whatsapp")
            await SocialMedia.createSocialMedia("Viber")
            await SocialMedia.createSocialMedia("Tiktok")

        }catch(err){
            logger.error('error on socialMedia %s',err.stack)
        }
    }
}

export const settings = async () => {
    const settings = await Setting.getSettings()
    if(settings.length === 0){
        try{
            await Setting.createSetting("Some Text", {email: "info@finnep.fi", phone: "+358442733404"}, {fb: "https://www.facebook.com/finnep", x: "https://x.com/finnep", instagram: "https://www.instagram.com/finnep"}, otherInfo)
        }catch(err){
            logger.error('error on settings %s',err.stack)
        }
    }
}

const otherInfo ={
    "terms_and_conditions": {
      "introduction": {
        "title": "Introduction",
        "text": "Thank you for visiting our event ticketing platform (the 'Website'). This website is operated by Finnep ('we,' 'us,' or 'our'). These Terms and Conditions ('Terms') govern your use of the Website and the purchase or registration of event tickets through our platform. By accessing or using the Website, or by purchasing or registering for tickets, you agree to be bound by these Terms."
      },
      "use_of_the_website": {
        "title": "Use of the Website",
        "text": "You may use the Website to browse events and purchase or register for tickets for your personal attendance at events. You agree to use the Website in accordance with these Terms and applicable laws. You may not:",
        "prohibitions": [
          "Use the Website for any illegal or unauthorized purpose.",
          "Modify, translate, reverse engineer, decompile, disassemble, or create derivative works of the Website.",
          "Interfere with the security of the Website or attempt to gain unauthorized access to the Website or servers that power the Website.",
          "Violate any applicable laws or regulations.",
          "Purchase or register for tickets for the purpose of unauthorized resale at a premium or for commercial resale purposes without the express permission of the event organizer.",
          "Use automated systems, bots, or scripts to purchase or register for tickets.",
          "Purchase or register for tickets in bulk quantities beyond reasonable personal use without authorization."
        ]
      },
      "ticket_purchases": {
        "title": "Ticket Purchases and Registrations",
        "text": "Tickets for events are issued through our platform on behalf of event organizers and merchants. Events may be paid or free. For paid events, when you purchase a ticket, you enter into a contract with the event organizer, not with Finnep. For free events, when you register for a ticket, you agree to attend the event subject to the event organizer's terms. You are responsible for providing accurate and complete information, including your email address, which is required to create and deliver your ticket. For paid events, you must also provide valid payment details. All ticket purchases and registrations are subject to availability and event capacity limits. We reserve the right to refuse or cancel any ticket purchase or registration at our discretion, including but not limited to cases of suspected fraud, technical errors, or violation of these Terms."
      },
      "ticket_prices_and_payment": {
        "title": "Ticket Prices and Payment",
        "text": "This section applies to paid events only. Free events do not require payment. For paid events, ticket prices are set by the event organizers and are displayed in the currency specified for each event. All prices are inclusive of applicable taxes unless otherwise stated. Additional service fees, processing fees, and VAT may apply to your purchase and will be clearly displayed before you complete your transaction. Prices are subject to change without notice until you complete your purchase. Once a ticket is purchased, the price is final. You agree to pay for all paid event tickets using a valid payment method. Payment must be completed at the time of purchase. We accept major credit cards and other payment methods as displayed on the Website."
      },
      "event_cancellations_and_postponements": {
        "title": "Event Cancellations and Postponements",
        "text": "Events may be cancelled or postponed by the event organizer for various reasons, including but not limited to weather conditions, force majeure, artist unavailability, or insufficient ticket sales. In the event of a cancellation or postponement, we will notify you via the email address provided during ticket purchase or registration. The event organizer is responsible for determining refund policies for cancelled or postponed events. For paid events, if an event is postponed, your ticket will typically remain valid for the rescheduled date. If you cannot attend the rescheduled date, you may be entitled to a refund as determined by the event organizer's refund policy. For free events, tickets will remain valid for the rescheduled date, but no refunds apply as no payment was made."
      },
      "refund_policy": {
        "title": "Refund Policy",
        "text": "This section applies to paid events only. Free events do not involve payment and therefore no refunds apply. For paid events, refund policies are determined by each event organizer and may vary by event. Generally, all ticket sales are final unless an event is cancelled or significantly postponed. Service fees and processing fees are typically non-refundable. To request a refund, you must contact the event organizer directly or reach out to us at info@finnep.fi with your ticket details. Refund requests must be submitted within the timeframe specified by the event organizer. We are not responsible for refund decisions made by event organizers. If a refund is approved, it will be processed to the original payment method used for the purchase and may take 5-10 business days to appear in your account."
      },
      "ticket_transfer_and_resale": {
        "title": "Ticket Transfer and Resale",
        "text": "Tickets are personal to the ticket holder (whether purchased for paid events or registered for free events) and may not be transferred or resold without the express permission of the event organizer. Unauthorized resale of tickets at a premium is prohibited, especially for paid events. If you are unable to attend an event, you may contact the event organizer to inquire about transfer or resale options. We are not responsible for any issues arising from ticket transfers or resales. Lost or stolen tickets may not be replaced, and duplicate tickets will be voided."
      },
      "entry_requirements": {
        "title": "Entry Requirements",
        "text": "Entry to events is subject to the event organizer's terms and conditions, venue policies, and applicable laws. You must present a valid ticket (either printed or digital) at the event venue. The event organizer and venue reserve the right to refuse entry for any reason, including but not limited to:",
        "prohibitions": [
          "Failure to present a valid ticket or identification.",
          "Violation of venue policies or codes of conduct.",
          "Intoxication or disorderly behavior.",
          "Carrying prohibited items as specified by the venue.",
          "Failure to comply with age restrictions or other entry requirements."
        ],
        "note": "Late arrival may result in denied entry, and no refunds will be provided in such cases."
      },
      "age_restrictions": {
        "title": "Age Restrictions",
        "text": "Some events may have age restrictions (e.g., 18+, 21+). It is your responsibility to verify age requirements before purchasing tickets. Age restrictions are clearly displayed on each event page. Valid identification may be required at the venue to verify age. Minors must be accompanied by a parent or legal guardian if required by the event organizer. We are not responsible if you are denied entry due to age restrictions, and no refunds will be provided in such cases."
      },
      "door_sales": {
        "title": "Door Sales",
        "text": "Some events may offer tickets for purchase at the door on the day of the event, subject to availability. Door sale prices may differ from online prices and may include additional fees. Door sales are subject to venue capacity limits and are not guaranteed. We recommend purchasing tickets in advance to secure your attendance."
      },
      "disclaimer": {
        "title": "Disclaimer",
        "text": "The Website and event information are provided 'as is' and without warranties of any kind, express or implied. We act as a ticketing platform and are not responsible for the content, quality, or execution of events. We disclaim all warranties, including, but not limited to, the implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Website will be uninterrupted or error-free, that defects will be corrected, or that the Website or the server that makes it available are free of viruses or other harmful components. Event details, including dates, times, performers, and venues, are subject to change by event organizers without notice."
      },
      "limitation_of_liability": {
        "title": "Limitation of Liability",
        "text": "To the fullest extent permitted by law, Finnep shall not be liable for any damages arising out of or related to your use of the Website, attendance at events, or purchase of tickets, including, but not limited to, direct, indirect, incidental, consequential, punitive, or special damages. This includes, without limitation, damages for loss of profits, goodwill, use, data, or other intangible losses resulting from event cancellations, postponements, changes, or any issues at the event venue. Our total liability to you for any claims related to ticket purchases shall not exceed the amount you paid for the tickets in question."
      },
      "intellectual_property": {
        "title": "Intellectual Property",
        "text": "The Website and all content on the Website, including but not limited to text, graphics, logos, images, event descriptions, and software, are the property of Finnep or its licensors and are protected by copyright, trademark, and other intellectual property laws. Event content, including images and descriptions, may be the property of event organizers. You may not use any content on the Website without our prior written permission or the permission of the respective rights holder."
      },
      "termination": {
        "title": "Termination",
        "text": "We may terminate or suspend your access to the Website at any time, for any reason, without notice, including but not limited to violation of these Terms, fraudulent activity, or abuse of the platform. Upon termination, your right to use the Website will immediately cease, but any tickets you have already purchased will remain valid subject to the event organizer's terms."
      },
      "governing_law": {
        "title": "Governing Law",
        "text": "These Terms shall be governed by and construed in accordance with the laws of Finland, without regard to its conflict of law provisions. Any disputes arising from these Terms or your use of the Website shall be subject to the exclusive jurisdiction of the courts of Finland."
      },
      "entire_agreement": {
        "title": "Entire Agreement",
        "text": "These Terms, together with any additional terms and conditions provided by event organizers, constitute the entire agreement between you and us regarding your use of the Website and purchase of tickets. If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full effect."
      },
      "changes_to_the_terms": {
        "title": "Changes to the Terms",
        "text": "We may revise these Terms at any time by posting the revised Terms on the Website. The revised Terms will be effective immediately upon posting. Your continued use of the Website or purchase of tickets following the posting of revised Terms means that you accept and agree to the changes. You are expected to check this page periodically so you are aware of any changes, as they are binding on you."
      },
      "contact_us": {
        "title": "Contact Us",
        "text": "If you have any questions about these Terms, ticket purchases, or events, please contact us at info@finnep.fi or +358442733404. For event-specific inquiries, please contact the event organizer directly."
      }
    },
    "privacy_policy": {
      "introduction": {
        "title": "Introduction",
        "text": "Finnep (\"we,\" \"us,\" or \"our\") operates this event ticketing platform (the \"Website\"). This Privacy Policy informs you about our policies regarding the collection, use, and disclosure of personal data when you use the Website to browse events, purchase or register for tickets, and the choices you have associated with that data."
      },
      "information_we_collect": {
        "title": "Information We Collect",
        "text": "We collect minimal personal information necessary to provide our ticketing services:",
        "bullet_points": [
          "Email Address: When you purchase or register for a ticket, we collect your email address. This is required to create your ticket and send it to you via email. Your email address is also used to notify you about event updates, cancellations, or postponements.",
          "Payment Information: For paid events, payment information is collected and processed by our secure payment processor (Stripe). We do not store your full payment card details on our servers. Payment information is handled in accordance with our payment processor's privacy policy and security standards.",
          "Event Information: We collect information about the events you attend, including event details, ticket quantities, and purchase/registration dates. This information is necessary to manage your tickets and provide customer support."
        ],
        "note": "We do not use cookies or tracking technologies to collect personal information. We do not collect your name, phone number, or other personal details unless you voluntarily provide them through direct communication with us or event organizers."
      },
      "use_of_information": {
        "title": "Use of Information",
        "text": "We use the information we collect solely for the following purposes:",
        "bullet_points": [
          "To create and deliver your tickets via email.",
          "To send you important notifications about events you have tickets for, such as cancellations, postponements, or changes.",
          "To process payments for paid events through our secure payment processor.",
          "To provide customer support and respond to your inquiries.",
          "To comply with legal obligations and prevent fraud."
        ]
      },
      "legal_basis_for_processing": {
        "title": "Legal Basis for Processing (GDPR)",
        "text": "Under the General Data Protection Regulation (GDPR), we process your personal data based on the following legal bases:",
        "bullet_points": [
          "Contract Performance (Article 6(1)(b) GDPR): We process your email address and ticket information to fulfill our contract with you - namely, to create and deliver your tickets and provide the ticketing services you have requested.",
          "Legitimate Interests (Article 6(1)(f) GDPR): We process your data for our legitimate interests in sending you important event notifications (cancellations, postponements), preventing fraud, ensuring platform security, providing customer support, and improving our services.",
          "Legal Obligation (Article 6(1)(c) GDPR): We may process your data to comply with legal obligations, such as tax reporting, accounting requirements, or responding to lawful requests from authorities.",
          "Consent (Article 6(1)(a) GDPR): For any optional communications or services beyond the core ticketing functionality, we will obtain your explicit consent before processing your data."
        ],
        "note": "You have the right to object to processing based on legitimate interests. If you wish to exercise this right, please contact us at info@finnep.fi. We will assess your request and, if we do not have compelling legitimate grounds to continue processing, we will stop processing your data for those purposes."
      },
      "disclosure_of_information": {
        "title": "Disclosure of Information",
        "text": "We share your information only as necessary to provide our services:",
        "bullet_points": [
          "Event Organizers and Merchants: We share your email address and ticket information with the event organizer or merchant hosting the event. This is necessary for them to manage their events, verify ticket holders, and communicate with attendees. Event organizers may use your email address to send you event-related communications.",
          "Payment Processors: For paid events, we share payment information with our payment processor (Stripe) to process transactions. This is done securely and in accordance with industry standards.",
          "Legal Requirements: We may disclose your information if required by law, court order, or government regulation, or to protect our rights, property, or safety, or that of our users or others."
        ],
        "note": "We do not sell, rent, or trade your personal information to third parties for marketing purposes. We do not share your information with advertisers or data brokers."
      },
      "data_retention": {
        "title": "Data Retention",
        "text": "We retain your email address and ticket information for as long as necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. This includes retaining information for customer support purposes, legal compliance, and dispute resolution. After the retention period, we will securely delete or anonymize your personal information."
      },
      "your_rights": {
        "title": "Your Rights",
        "text": "You have the following rights regarding your personal information:",
        "bullet_points": [
          "Access: You can request access to the personal information we hold about you.",
          "Correction: You can request correction of inaccurate or incomplete information.",
          "Deletion: You can request deletion of your personal information, subject to legal and operational requirements.",
          "Objection: You can object to our processing of your personal information in certain circumstances.",
          "Data Portability: You can request a copy of your personal information in a structured, machine-readable format."
        ],
        "note": "To exercise these rights, please contact us at info@finnep.fi. We will respond to your request within a reasonable timeframe and in accordance with applicable data protection laws."
      },
      "childrens_privacy": {
        "title": "Children's Privacy",
        "text": "Our Website is not intended for children under the age of 13. We do not knowingly collect personal data from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us at info@finnep.fi and we will delete such information. Some events may have age restrictions (e.g., 18+, 21+), and it is the responsibility of parents or guardians to ensure compliance with such restrictions."
      },
      "security": {
        "title": "Security",
        "text": "We take reasonable technical and organizational measures to protect your personal data from unauthorized access, disclosure, alteration, or destruction. This includes using secure servers, encryption for data transmission, and access controls. However, no method of transmission over the internet or electronic storage is 100% secure, and we cannot guarantee absolute security. We encourage you to use strong, unique passwords and to be cautious when sharing personal information online."
      },
      "third_party_links": {
        "title": "Third-Party Links",
        "text": "Our Website may contain links to third-party websites, such as event organizer websites, venue websites, or social media platforms. We are not responsible for the privacy practices or content of these third-party sites. We encourage you to review the privacy policies of any third-party sites you visit."
      },
      "international_data_transfers": {
        "title": "International Data Transfers and GDPR Compliance",
        "text": "We are committed to complying with the General Data Protection Regulation (GDPR) and other applicable data protection laws. Your personal information is primarily processed and stored within the European Economic Area (EEA).",
        "bullet_points": [
          "Data Processing Location: We process and store your personal data on servers located within the EEA. This ensures that your data is subject to EU data protection standards.",
          "Third-Party Service Providers: Some of our service providers (such as payment processors, email service providers, or cloud hosting services) may process your data outside the EEA. When this occurs, we ensure that appropriate safeguards are in place:",
          "Standard Contractual Clauses (SCCs): We use EU-approved Standard Contractual Clauses with service providers to ensure your data receives adequate protection.",
          "Adequacy Decisions: We only transfer data to countries that have been recognized by the European Commission as providing an adequate level of data protection, or we implement additional safeguards.",
          "Binding Corporate Rules: Where applicable, we rely on service providers' binding corporate rules that have been approved by relevant data protection authorities.",
          "Payment Processing: For paid events, payment information is processed by Stripe, which is PCI-DSS compliant and maintains appropriate safeguards for international data transfers."
        ],
        "note": "If you have questions about specific data transfers or wish to obtain a copy of the safeguards we have in place, please contact us at info@finnep.fi. You have the right to object to certain international data transfers, though this may affect our ability to provide certain services. We will inform you if this is the case."
      },
      "changes_to_this_privacy_policy": {
        "title": "Changes to This Privacy Policy",
        "text": "We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any material changes by posting the new Privacy Policy on the Website and updating the \"Last Updated\" date. Your continued use of the Website after such changes constitutes your acceptance of the updated Privacy Policy. We encourage you to review this Privacy Policy periodically to stay informed about how we protect your information."
      },
      "contact_us": {
        "title": "Contact Us",
        "text": "If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at info@finnep.fi or +358442733404. We will respond to your inquiry as soon as possible."
      }
    }
}