const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Reuse the same pure report validation that the desktop CRM uses.
config.watchFolders = [path.resolve(__dirname, '..', 'desktop-crm', 'src')];
module.exports = config;
