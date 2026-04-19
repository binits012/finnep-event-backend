import { compileMjmlTemplate } from '../util/emailTemplateLoader.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sampleCompanyName = process.env.COMPANY_TITLE || 'Finnep';
const sampleContactEmail = process.env.PLATFORM_EMAIL || process.env.EMAIL_USERNAME || 'info@finnep.fi';
const samplePlatformTeamSignature = process.env.COMPANY_TEAM_SIGNATURE || `The ${sampleCompanyName} Team`;
const sampleBusinessId = process.env.BUSINESS_ID || '3579764-6';
const sampleSocialMedidFB = process.env.SOCIAL_MEDIA_FB || 'https://www.facebook.com/profile.php?id=61565375592900';
const sampleSocialMedidLN = process.env.SOCIAL_MEDIA_LN || 'https://www.linkedin.com/company/105069196/admin/dashboard/';
const sampleCompanyWebsiteUrl = process.env.COMPANY_WEBSITE_URL || 'https://finnep.fi';
let sampleCompanyWebsiteLabel = process.env.COMPANY_WEBSITE_LABEL;
if (!sampleCompanyWebsiteLabel) {
  try {
    sampleCompanyWebsiteLabel = new URL(sampleCompanyWebsiteUrl).hostname.replace(/^www\./i, '');
  } catch {
    sampleCompanyWebsiteLabel = 'finnep.fi';
  }
}
const sampleCareersUrl = process.env.COMPANY_CAREERS_URL || `${sampleCompanyWebsiteUrl.replace(/\/$/, '')}/careers`;
let sampleCareersLabel = process.env.COMPANY_CAREERS_LABEL;
if (!sampleCareersLabel) {
  try {
    const u = new URL(sampleCareersUrl);
    const host = u.hostname.replace(/^www\./i, '');
    const p = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '';
    sampleCareersLabel = p ? `${host}${p}` : host;
  } catch {
    sampleCareersLabel = 'finnep.fi/careers';
  }
}
const sampleHiringTeamSignature = process.env.COMPANY_HIRING_TEAM_SIGNATURE || `The ${sampleCompanyName} Hiring Team`;

const sampleAckBranding = {
  companyName: sampleCompanyName,
  brandingContactEmail: sampleContactEmail,
  companyWebsiteUrl: sampleCompanyWebsiteUrl,
  companyWebsiteLabel: sampleCompanyWebsiteLabel,
  careersUrl: sampleCareersUrl,
  careersLabel: sampleCareersLabel,
  platformTeamSignature: samplePlatformTeamSignature,
  hiringTeamSignature: sampleHiringTeamSignature
};

// Sample data for different templates
const sampleDataMap = {
  ticket_template: {
    companyLogo: 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
    eventPromotionalPhoto: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800',
    eventTitle: 'Summer Music Festival 2024',
    companyName: sampleCompanyName,
    attendeeName: 'John Doe',
    ticketCode: 'ABC123XYZ',
    eventDate: 'Saturday, July 15, 2024',
    eventTime: '7:00 PM',
    doorsOpenTime: '6:30 PM',
    venueName: 'Central Park Amphitheater',
    venueAddress: '123 Park Avenue, New York, NY 10001',
    venueMapLink: 'https://maps.google.com/?q=Central+Park',
    purchaseDate: 'June 1, 2024',
    ticketName: 'General Admission',
    quantity: 2,
    basePrice: '€45.00',
    serviceFee: '€4.50',
    serviceTaxAmount: '€1.15',
    serviceTaxRate: '25.5',
    vatAmount: '€5.40',
    vatRate: '12',
    orderFee: '€2.00',
    orderFeeServiceTax: '€0.51',
    totalAmount: '€56.90',
    publicTransportLink: 'https://maps.google.com/transit?q=Central+Park+Amphitheater',
    publicTransportInfo: 'Take subway line 1, 2, or 3 to 59th Street-Columbus Circle station.',
    organizerName: 'Event Organizers Inc.',
    organizerEmail: 'contact@eventorganizers.com',
    organizerPhone: '+1 (555) 123-4567',
    brandingContactEmail: sampleContactEmail,
    businessId: sampleBusinessId,
    socialMedidFB: sampleSocialMedidFB,
    socialMedidLN: sampleSocialMedidLN
  },
  verification_code: {
    companyName: sampleCompanyName,
    verificationCode: '123456',
    brandingContactEmail: sampleContactEmail,
    currentYear: new Date().getFullYear()
  },
  career_acknowledgement: {
    name: 'Jane Smith',
    position: 'Senior Software Engineer',
    date: 'January 15, 2024',
    email: 'jane.smith@example.com',
    phone: '+358 50 123 4567',
    experience: '5+ years in full-stack development',
    availability: 'Available immediately',
    ...sampleAckBranding
  },
  feedback_acknowledgement: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    subject: 'Feature Request - Dark Mode',
    message: 'I would love to see a dark mode option in the mobile app. It would be great for evening browsing!',
    date: 'January 15, 2024',
    ...sampleAckBranding
  },
  merchant_activated: {
    orgName: 'Okazzo Oy Events',
    dashboardUrl: 'https://eventapp.finnep.fi/merchant/dashboard',
    companyLogo: process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
    companyName: sampleCompanyName,
    brandingContactEmail: sampleContactEmail,
    platformTeamSignature: samplePlatformTeamSignature,
    closingRegards: 'Best regards,',
    businessId: sampleBusinessId,
    socialMedidFB: sampleSocialMedidFB,
    socialMedidLN: sampleSocialMedidLN
  },
  merchant_arrival: {
    orgName: 'Okazzo Oy Events',
    dashboardUrl: 'https://eventapp.finnep.fi/merchant/dashboard',
    companyLogo: process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
    companyName: sampleCompanyName,
    brandingContactEmail: sampleContactEmail,
    platformTeamSignature: samplePlatformTeamSignature,
    closingRegards: 'Best regards,',
    businessId: sampleBusinessId,
    socialMedidFB: sampleSocialMedidFB,
    socialMedidLN: sampleSocialMedidLN
  },
  merchant_suspended: {
    orgName: 'Okazzo Oy Events',
    companyLogo: process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png',
    companyName: sampleCompanyName,
    brandingContactEmail: sampleContactEmail,
    platformTeamSignature: samplePlatformTeamSignature,
    closingRegards: 'Best regards,',
    businessId: sampleBusinessId,
    socialMedidFB: sampleSocialMedidFB,
    socialMedidLN: sampleSocialMedidLN
  },
  failure_report: {
    adminName: 'Admin User',
    trData: `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">1</td>
        <td style="padding: 8px; border: 1px solid #ddd;">user1@example.com</td>
        <td style="padding: 8px; border: 1px solid #ddd;">Summer Music Festival</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">2</td>
        <td style="padding: 8px; border: 1px solid #ddd;">user2@example.com</td>
        <td style="padding: 8px; border: 1px solid #ddd;">Tech Conference 2024</td>
      </tr>
    `
  }
};

async function testAllTemplates() {
  const templatesDir = path.join(__dirname, '..', 'emailTemplates');
  const previewDir = path.join(__dirname, '..', 'preview');

  // Create preview directory if it doesn't exist
  try {
    await fs.mkdir(previewDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  console.log('🧪 Testing all email templates...\n');

  const results = {
    success: [],
    failed: []
  };

  for (const [templateName, sampleData] of Object.entries(sampleDataMap)) {
    try {
      const templatePath = path.join(templatesDir, `${templateName}.mjml`);

      // Check if template exists
      try {
        await fs.access(templatePath);
      } catch (error) {
        console.log(`⚠️  ${templateName}: Template file not found`);
        results.failed.push({ template: templateName, error: 'Template file not found' });
        continue;
      }

      // Compile the template
      const html = await compileMjmlTemplate(templatePath, sampleData);

      // Save HTML to file
      const outputPath = path.join(previewDir, `${templateName}_preview.html`);
      await fs.writeFile(outputPath, html, 'utf8');

      console.log(`✅ ${templateName}: Compiled successfully`);
      results.success.push(templateName);

    } catch (error) {
      console.error(`❌ ${templateName}: ${error.message}`);
      results.failed.push({ template: templateName, error: error.message });
    }
  }

  console.log('\n📊 Test Summary:');
  console.log(`   ✅ Success: ${results.success.length}`);
  console.log(`   ❌ Failed: ${results.failed.length}`);

  if (results.success.length > 0) {
    console.log('\n✅ Successful templates:');
    results.success.forEach(template => {
      console.log(`   - ${template}`);
    });
  }

  if (results.failed.length > 0) {
    console.log('\n❌ Failed templates:');
    results.failed.forEach(({ template, error }) => {
      console.log(`   - ${template}: ${error}`);
    });
  }

  console.log(`\n📄 Preview files saved to: ${previewDir}`);
  console.log('💡 Open the HTML files in your browser to view the templates.\n');

  process.exit(results.failed.length > 0 ? 1 : 0);
}

testAllTemplates();

