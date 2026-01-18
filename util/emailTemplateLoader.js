import fs from 'fs/promises';
import path from 'path';
import mjml from 'mjml';
import Handlebars from 'handlebars';

/**
 * Compiles an MJML template with Handlebars variable substitution
 * @param {string} templatePath - Path to the .mjml template file
 * @param {Object} variables - Object containing variables to substitute in the template
 * @returns {Promise<string>} Compiled HTML string
 */
export const compileMjmlTemplate = async (templatePath, variables = {}) => {
  try {
    // Read the MJML template file
    const mjmlContent = await fs.readFile(templatePath, 'utf8');

    // Compile with Handlebars for variable substitution
    const handlebarsTemplate = Handlebars.compile(mjmlContent);
    const mjmlWithVariables = handlebarsTemplate(variables);

    // Compile MJML to HTML
    // SECURITY: minify is set to false, so html-minifier is NEVER executed at runtime
    // - html-minifier has REDoS vulnerability (CVE-2022-37620) but is overridden with html-minifier-terser@7.2.0
    // - Even if override fails, minify: false ensures vulnerable code path is never executed
    // - This is safe for production use
    const { html, errors } = mjml(mjmlWithVariables, {
      minify: false, // CRITICAL: Must remain false - prevents execution of any minification code
      validationLevel: 'soft', // Use 'soft' to allow some warnings without failing
      keepComments: false,
      beautify: false
    });

    // Log warnings if any (but don't fail)
    if (errors && errors.length > 0) {
      console.warn('MJML compilation warnings:', errors);
    }

    return html;
  } catch (error) {
    console.error(`Error compiling MJML template ${templatePath}:`, error);
    throw new Error(`Failed to compile email template: ${error.message}`);
  }
};

/**
 * Register custom Handlebars helpers for email templates
 */
export const registerHandlebarsHelpers = () => {
  // Date formatting helper
  Handlebars.registerHelper('formatDate', (date, format) => {
    if (!date) return '';
    const d = new Date(date);
    const options = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return d.toLocaleDateString('en-US', options);
  });

  // Conditional helper for checking if value exists
  Handlebars.registerHelper('ifExists', function(value, options) {
    if (value !== null && value !== undefined && value !== '') {
      return options.fn(this);
    }
    return options.inverse(this);
  });

  // Escape HTML helper (for unescaped content like trData)
  Handlebars.registerHelper('unescaped', function(context) {
    return new Handlebars.SafeString(context);
  });

  // Translation helper: {{t.key}} accesses translations object
  // The translations object is passed as 't' in the template variables
  // We register a helper that allows dot notation access
  // Note: Handlebars automatically handles dot notation for object properties
  // So {{t.title}} will work if 't' is in the template context
  // We don't need a custom helper for this - Handlebars handles it natively
};

// Register helpers on module load
registerHandlebarsHelpers();

