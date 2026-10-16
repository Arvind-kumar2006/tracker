const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Watchman cannot access this macOS Desktop workspace reliably. Metro's Node crawler
// works without the Watchman daemon and is sufficient for this app.
config.resolver.useWatchman = false;

module.exports = config;
