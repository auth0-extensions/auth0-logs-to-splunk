const tools = require('auth0-extension-express-tools');

const expressApp = require('./server/index');
const logger = require('./server/lib/logger');

module.exports = tools.createServer((config, storage) => {
  logger.info('Starting Logs to Splunk extension - Version:', process.env.CLIENT_VERSION);
  return expressApp(config, storage);
});
