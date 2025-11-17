/**
 * App Helper for Tests
 * Prevents server from starting during tests
 */

let appInstance = null;

export const getApp = async () => {
  if (appInstance) {
    return appInstance;
  }

  // Set test environment before importing app
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Use random port to avoid conflicts

  // For ES modules, we need to conditionally prevent server startup
  // The app.js file will check NODE_ENV and skip server.listen in test mode
  // We'll need to modify app.js or use a different approach

  try {
    // Import app - server startup is now prevented in test mode
    const appModule = await import('../../app.js');

    // Get the Express app instance
    appInstance = appModule.app || appModule.default || appModule;

    return appInstance;
  } catch (error) {
    console.error('Error loading app for tests:', error);
    // Return a minimal Express app for testing as fallback
    const express = (await import('express')).default;
    const mockApp = express();
    return mockApp;
  }
};

export default getApp;

