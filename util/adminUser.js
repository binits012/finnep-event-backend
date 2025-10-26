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
        "text": "Thank you for visiting our website (the 'Website'). This website is operated by [Finnep] ('we,' 'us,' or 'our'). These Terms and Conditions ('Terms') govern your use of the Website. By accessing or using the Website, you agree to be bound by these Terms."
      },
      "use_of_the_website": {
        "title": "Use of the Website",
        "text": "You may use the Website for personal, non-commercial purposes only. You may not:",
        "prohibitions": [
          "Use the Website for any illegal or unauthorized purpose.",
          "Modify, translate, reverse engineer, decompile, disassemble, or create derivative works of the Website.",
          "Interfere with the security of the Website or attempt to gain unauthorized access to the Website or servers that power the Website.",
          "Violate any applicable laws or regulations."
        ]
      },
      "orders": {
        "title": "Orders",
        "text": "You may be able to place online orders through the Website. Online orders are subject to availability and menu changes. We reserve the right to cancel or modify orders at any time, for any reason, with reasonable notice. You are responsible for providing accurate and complete information when placing an order. You agree to pay for all online orders using a valid payment method."
      },
      "prices_and_payment": {
        "title": "Prices and Payment",
        "text": "Prices listed on the Website are subject to change without notice. We reserve the right to correct any pricing errors on the Website. You are responsible for all taxes and fees associated with your order."
      },
      "disclaimer": {
        "title": "Disclaimer",
        "text": "The Website is provided 'as is' and without warranties of any kind, express or implied. We disclaim all warranties, including, but not limited to, the implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Website will be uninterrupted or error-free, that defects will be corrected, or that the Website or the server that makes it available are free of viruses or other harmful components."
      },
      "limitation_of_liability": {
        "title": "Limitation of Liability",
        "text": "We shall not be liable for any damages arising out of or related to your use of the Website, including, but not limited to, direct, indirect, incidental, consequential, punitive, or special damages."
      },
      "intellectual_property": {
        "title": "Intellectual Property",
        "text": "The Website and all content on the Website, including but not limited to text, graphics, logos, images, and software, are the property of [Finnep] or its licensors and are protected by copyright, trademark, and other intellectual property laws. You may not use any content on the Website without our prior written permission."
      },
      "termination": {
        "title": "Termination",
        "text": "We may terminate your access to the Website at any time, for any reason, without notice."
      },
      "governing_law": {
        "title": "Governing Law",
        "text": "These Terms shall be governed by and construed in accordance with the laws of [State], without regard to its conflict of law provisions."
      },
      "entire_agreement": {
        "title": "Entire Agreement",
        "text": "These Terms constitute the entire agreement between you and us regarding your use of the Website."
      },
      "changes_to_the_terms": {
        "title": "Changes to the Terms",
        "text": "We may revise these Terms at any time by posting the revised Terms on the Website. The revised Terms will be effective immediately upon posting. Your continued use of the Website following the posting of revised Terms means that you accept and agree to the changes. You are expected to check this page periodically so you are aware of any changes, as they are binding on you."
      },
      "contact_us": {
        "title": "Contact Us",
        "text": "If you have any questions about these Terms, please contact us at info@finnep.fi or ++358442733404."
      }
    },
    "privacy_policy": {
      "introduction": {
        "title": "Introduction",
        "text": "[Finnep] (\"we,\" \"us,\" or \"our\") operates this website (the \"Website\"). This Privacy Policy informs you about our policies regarding the collection, use, and disclosure of personal data when you use the Website and the choices you have associated with that data."
      },
      "information_we_collect": {
        "title": "Information We Collect",
        "text": "We use cookies on the Website. Cookies are small data files that a website transfers to your computer's hard drive for record-keeping purposes. We use cookies to:",
        "bullet_points": [
          "Store your preferred locale: This allows us to display the Website content in your preferred language when you return."
        ],
        "note": "We do not collect any other personal data through cookies or other automated means on this Website."
      },
      "use_of_information": {
        "title": "Use of Information",
        "text": "We use the locale information gathered from the cookie solely to personalize your experience on the Website by displaying content in your preferred language."
      },
      "disclosure_of_information": {
        "title": "Disclosure of Information",
        "text": "We do not share the locale information collected through cookies with any third parties except as necessary to operate the Website."
      },
      "your_choices": {
        "title": "Your Choices",
        "text": "You can configure your web browser to refuse cookies or to delete cookies at any time. However, if you choose to disable cookies, some features of the Website may not function as intended."
      },
      "childrens_privacy": {
        "title": "Children's Privacy",
        "text": "Our Website is not intended for children under the age of 13. We do not knowingly collect personal data from children under 13."
      },
      "security": {
        "title": "Security",
        "text": "We take reasonable precautions to protect your personal data from unauthorized access, disclosure, alteration, or destruction. However, no website or internet transmission is completely secure, and we cannot guarantee the security of your personal data."
      },
      "changes_to_this_privacy_policy": {
        "title": "Changes to This Privacy Policy",
        "text": "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on the Website. You are advised to review this Privacy Policy periodically for any changes."
      },
      "contact_us": {
        "title": "Contact Us",
        "text": "If you have any questions about this Privacy Policy, please contact us at info@finnep.fi or ++358442733404."
      }
    }
}