import esbuild from 'esbuild';
esbuild.build({
  // Entry points for your application code
  entryPoints: ["app.js"], 

  // Output file name for the bundled code
  outfile: "yellowbridge.min.js",

  // Enable minification for production builds
  minify: process.env.NODE_ENV === "production",

  // Generate source maps for debugging
  sourcemap: process.env.NODE_ENV === "development",

  // Bundle format (iife, cjs, esm)
  format: "esm", // Adjust based on your needs (e.g., CJS for Node.js)

  bundle:true,
  // Target ECMAScript version for compatibility
  target: "es2022", // Adjust based on your target audience's browsers

  // Enable watching for development (rebuilds on file changes)
  //watch: process.env.NODE_ENV === "development",

  // Define external libraries (not bundled)
  external: ['winston', 'bcrypt', 'express', 'dotenv','mongoose', 'bullmq', 'winston-daily-rotate-file', "@smithy", "@aws-sdk",
   "crypto", 'ics', 'qrcode','mongodb', 'nodemailer', 'exceljs', 'jsonwebtoken', 'redis', 'busboy', 'stripe', '@hokify','/node_modules/*'], // Example for external libraries

  // Enable splitting large bundles into chunks
  //splitting: true, // Adjust options as needed

  // Define loader configuration for custom file types
  loader: {
    ".css": "css",   // Load CSS files
    ".png": "file",  // Load image files as assets
    // ... add loaders for other file types
  },

  // Define plugins for advanced functionality (not built-in)
  plugins: [
    // ... require and configure plugins here
  ],
  minify:true,
  //outdir:"temp",
  platform:'node', 
  // Define custom resolve options for module paths
  // ... resolve options
})
.catch(() => process.exit(1));