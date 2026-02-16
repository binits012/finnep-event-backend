import { compileMjmlTemplate } from '../util/emailTemplateLoader.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sample data for different templates
const sampleDataMap = {
  ticket_template: {
    // Header & Branding
    companyLogo: 'https://d3ibhfrhdk2dm6.cloudfront.net/120px100.png',
    eventPromotionalPhoto: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800',
    eventTitle: 'Summer Music Festival 2024',
    companyName: 'Finnep',

    // Attendee & Ticket
    attendeeName: 'John Doe',
    ticketCode: 'ABC123XYZ',

    // Event Details
    eventDate: 'Saturday, July 15, 2024',
    eventTime: '7:00 PM',
    doorsOpenTime: '6:30 PM',
    venueName: 'Central Park Amphitheater',
    venueAddress: '123 Park Avenue, New York, NY 10001',
    venueMapLink: 'https://maps.google.com/?q=Central+Park',

    // Order & Pricing
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

    // Transportation
    publicTransportLink: 'https://maps.google.com/transit?q=Central+Park+Amphitheater',
    publicTransportInfo: 'Take subway line 1, 2, or 3 to 59th Street-Columbus Circle station. The venue is a 5-minute walk.',

    // Organizer Contact
    organizerName: 'Event Organizers Inc.',
    organizerEmail: 'contact@eventorganizers.com',
    organizerPhone: '+1 (555) 123-4567',

    // Platform & Footer
    platformMailTo: 'info@finnep.fi',
    businessId: '3579764-6',
    socialMedidFB: 'https://www.facebook.com/profile.php?id=61565375592900',
    socialMedidLN: 'https://www.linkedin.com/company/105069196/admin/dashboard/'
  },

  verification_code: {
    companyName: 'Finnep',
    verificationCode: '123456',
    contactEmail: 'info@finnep.fi',
    currentYear: new Date().getFullYear()
  },

  career_acknowledgement: {
    name: 'Jane Smith',
    position: 'Senior Software Engineer',
    date: 'January 15, 2024',
    email: 'jane.smith@example.com',
    phone: '+358 50 123 4567',
    experience: '5+ years in full-stack development',
    availability: 'Available immediately'
  },

  feedback_acknowledgement: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    subject: 'Feature Request - Dark Mode',
    message: 'I would love to see a dark mode option in the mobile app. It would be great for evening browsing!',
    date: 'January 15, 2024'
  },

  merchant_activated: {
    orgName: 'Okazzo Oy Events',
    dashboardUrl: 'https://eventapp.finnep.fi/merchant/dashboard'
  },

  merchant_arrival: {
    orgName: 'Okazzo Oy Events',
    dashboardUrl: 'https://eventapp.finnep.fi/merchant/dashboard'
  },

  merchant_suspended: {
    orgName: 'Okazzo Oy Events'
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
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">3</td>
        <td style="padding: 8px; border: 1px solid #ddd;">user3@example.com</td>
        <td style="padding: 8px; border: 1px solid #ddd;">Jazz Night</td>
      </tr>
    `
  }
};

async function previewEmail(templateName = 'ticket_template') {
  try {
    console.log('📧 Compiling MJML template...');

    const templatePath = path.join(__dirname, '..', 'emailTemplates', `${templateName}.mjml`);

    // Check if template exists
    try {
      await fs.access(templatePath);
    } catch (error) {
      console.error(`❌ Template not found: ${templatePath}`);
      console.log('Available templates:');
      const files = await fs.readdir(path.join(__dirname, '..', 'emailTemplates'));
      const mjmlFiles = files.filter(f => f.endsWith('.mjml'));
      mjmlFiles.forEach(f => console.log(`  - ${f.replace('.mjml', '')}`));
      process.exit(1);
    }

    // Get sample data for this template
    const sampleData = sampleDataMap[templateName] || sampleDataMap.ticket_template;

    // Compile the template
    const html = await compileMjmlTemplate(templatePath, sampleData);

    // Create preview directory if it doesn't exist
    const previewDir = path.join(__dirname, '..', 'preview');
    try {
      await fs.mkdir(previewDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save HTML to file
    const outputPath = path.join(previewDir, `${templateName}_preview.html`);
    await fs.writeFile(outputPath, html, 'utf8');

    console.log(`✅ Template compiled successfully!`);
    console.log(`📄 Preview saved to: ${outputPath}`);

    // Open in browser
    const platform = process.platform;
    let command;

    if (platform === 'darwin') {
      command = `open "${outputPath}"`;
    } else if (platform === 'win32') {
      command = `start "" "${outputPath}"`;
    } else {
      command = `xdg-open "${outputPath}"`;
    }

    console.log('🌐 Opening in browser...');
    await execAsync(command);

    console.log('\n✨ Preview opened! You can edit the template and run this script again to see changes.');
    console.log(`\n💡 Available templates:`);
    Object.keys(sampleDataMap).forEach(template => {
      console.log(`   - ${template}`);
    });
    console.log(`\n📝 Usage: node scripts/preview-email.js <template_name>`);
    console.log(`   Example: node scripts/preview-email.js verification_code`);

  } catch (error) {
    console.error('❌ Error previewing email:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Get template name from command line argument
const templateName = process.argv[2] || 'ticket_template';

// Handle special commands
if (templateName === '--list' || templateName === '-l') {
  console.log('📧 Available email templates:\n');
  Object.keys(sampleDataMap).forEach(template => {
    console.log(`   ✓ ${template}`);
  });
  console.log('\n💡 Usage: node scripts/preview-email.js <template_name>');
  console.log('   Example: node scripts/preview-email.js verification_code\n');
  process.exit(0);
}

previewEmail(templateName);

