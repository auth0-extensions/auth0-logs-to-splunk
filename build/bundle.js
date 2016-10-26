module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var async = __webpack_require__(1);
	var moment = __webpack_require__(2);
	var useragent = __webpack_require__(3);
	var express = __webpack_require__(4);
	var Webtask = __webpack_require__(5);
	var app = express();
	var SplunkLogger = __webpack_require__(6).Logger;
	var Request = __webpack_require__(8);
	var memoizer = __webpack_require__(11);

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'SPLUNK_URL', 'SPLUNK_TOKEN'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startFromId = ctx.data.START_FROM ? ctx.data.START_FROM : null;
	    var startCheckpointId = typeof data === 'undefined' ? startFromId : data.checkpointId;

	    if (err) {
	      console.log('storage.get', err);
	    }

	    /**
	     * Here, batchInterval is set to flush every 10 second or when 100 events are queued
	     * Due to max batch limit of 100 in retrieval from Auth0, we would expect a SINGLE call.
	     */
	    var config = {
	      token: ctx.data.SPLUNK_TOKEN,
	      url: ctx.data.SPLUNK_URL,
	      port: ctx.data.SPLUNK_COLLECTOR_PORT || 8088,
	      path: ctx.data.SPLUNK_COLLECTOR_PATH || '/services/collector/event/1.0',
	      maxBatchCount: 0 // Manually flush events
	    };

	    // Create a new logger
	    var Logger = new SplunkLogger(config);

	    Logger.error = function (err, context) {
	      // Handle errors here
	      console.log("error", err, "context", context);
	    };

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);

	        take = take ? take : 100;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            console.log('Error getting logs from Auth0', err);
	            return callback(err);
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	            // return setImmediate(() => getLogs(context));
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Sending ' + context.logs.length);
	      if (context.logs.length > 0) {
	        context.logs.forEach(function (entry) {
	          Logger.send({ message: entry });
	        });
	        Logger.flush(function (err, resp, body) {
	          console.log("Response from Splunk:", body);
	          if (err) {
	            console.log('Error sending logs to Splunk', err);
	            return callback(err);
	          }
	          console.log('Upload complete.');
	          return callback(null, context);
	        });
	      } else {
	        // no logs, just callback
	        console.log('Upload complete.');
	        return callback(null, context);
	      }
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.', err);

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            console.log('Error storing startCheckpoint', error);
	            return res.status(500).send({ error: error });
	          }

	          res.status(500).send({
	            error: err
	          });
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          console.log('Error storing checkpoint', error);
	          return res.status(500).send({ error: error });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
	    level: 3 // Error
	  },
	  'f': {
	    event: 'Failed Login',
	    level: 3 // Error
	  },
	  'w': {
	    event: 'Warnings During Login',
	    level: 2 // Warning
	  },
	  'du': {
	    event: 'Deleted User',
	    level: 1 // Info
	  },
	  'fu': {
	    event: 'Failed Login (invalid email/username)',
	    level: 3 // Error
	  },
	  'fp': {
	    event: 'Failed Login (wrong password)',
	    level: 3 // Error
	  },
	  'fc': {
	    event: 'Failed by Connector',
	    level: 3 // Error
	  },
	  'fco': {
	    event: 'Failed by CORS',
	    level: 3 // Error
	  },
	  'con': {
	    event: 'Connector Online',
	    level: 1 // Info
	  },
	  'coff': {
	    event: 'Connector Offline',
	    level: 3 // Error
	  },
	  'fcpro': {
	    event: 'Failed Connector Provisioning',
	    level: 4 // Critical
	  },
	  'ss': {
	    event: 'Success Signup',
	    level: 1 // Info
	  },
	  'fs': {
	    event: 'Failed Signup',
	    level: 3 // Error
	  },
	  'cs': {
	    event: 'Code Sent',
	    level: 0 // Debug
	  },
	  'cls': {
	    event: 'Code/Link Sent',
	    level: 0 // Debug
	  },
	  'sv': {
	    event: 'Success Verification Email',
	    level: 0 // Debug
	  },
	  'fv': {
	    event: 'Failed Verification Email',
	    level: 0 // Debug
	  },
	  'scp': {
	    event: 'Success Change Password',
	    level: 1 // Info
	  },
	  'fcp': {
	    event: 'Failed Change Password',
	    level: 3 // Error
	  },
	  'sce': {
	    event: 'Success Change Email',
	    level: 1 // Info
	  },
	  'fce': {
	    event: 'Failed Change Email',
	    level: 3 // Error
	  },
	  'scu': {
	    event: 'Success Change Username',
	    level: 1 // Info
	  },
	  'fcu': {
	    event: 'Failed Change Username',
	    level: 3 // Error
	  },
	  'scpn': {
	    event: 'Success Change Phone Number',
	    level: 1 // Info
	  },
	  'fcpn': {
	    event: 'Failed Change Phone Number',
	    level: 3 // Error
	  },
	  'svr': {
	    event: 'Success Verification Email Request',
	    level: 0 // Debug
	  },
	  'fvr': {
	    event: 'Failed Verification Email Request',
	    level: 3 // Error
	  },
	  'scpr': {
	    event: 'Success Change Password Request',
	    level: 0 // Debug
	  },
	  'fcpr': {
	    event: 'Failed Change Password Request',
	    level: 3 // Error
	  },
	  'fn': {
	    event: 'Failed Sending Notification',
	    level: 3 // Error
	  },
	  'sapi': {
	    event: 'API Operation'
	  },
	  'fapi': {
	    event: 'Failed API Operation'
	  },
	  'limit_wc': {
	    event: 'Blocked Account',
	    level: 4 // Critical
	  },
	  'limit_ui': {
	    event: 'Too Many Calls to /userinfo',
	    level: 4 // Critical
	  },
	  'api_limit': {
	    event: 'Rate Limit On API',
	    level: 4 // Critical
	  },
	  'sdu': {
	    event: 'Successful User Deletion',
	    level: 1 // Info
	  },
	  'fdu': {
	    event: 'Failed User Deletion',
	    level: 3 // Error
	  }
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err) {
	      console.log('Error getting logs', err);
	      cb(null, err);
	    } else {
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	module.exports = Webtask.fromExpress(app);

/***/ },
/* 1 */
/***/ function(module, exports) {

	module.exports = require("async");

/***/ },
/* 2 */
/***/ function(module, exports) {

	module.exports = require("moment");

/***/ },
/* 3 */
/***/ function(module, exports) {

	module.exports = require("useragent");

/***/ },
/* 4 */
/***/ function(module, exports) {

	module.exports = require("express");

/***/ },
/* 5 */
/***/ function(module, exports) {

	module.exports = require("webtask-tools");

/***/ },
/* 6 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright 2015 Splunk, Inc.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License"): you may
	 * not use this file except in compliance with the License. You may obtain
	 * a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
	 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
	 * License for the specific language governing permissions and limitations
	 * under the License.
	 */

	var SplunkLogger = __webpack_require__(7);
	var utils = __webpack_require__(10);

	module.exports = {
	    Logger: SplunkLogger,
	    utils: utils
	};

/***/ },
/* 7 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * Copyright 2015 Splunk, Inc.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License"): you may
	 * not use this file except in compliance with the License. You may obtain
	 * a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
	 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
	 * License for the specific language governing permissions and limitations
	 * under the License.
	 */

	var request = __webpack_require__(8);
	var url = __webpack_require__(9);

	var utils = __webpack_require__(10);

	/**
	 * Default error handler for <code>SplunkLogger</code>.
	 * Prints the <code>err</code> and <code>context</code> to console.
	 *
	 * @param {Error|string} err - The error message, or an <code>Error</code> object.
	 * @param {object} [context] - The <code>context</code> of an event.
	 * @private
	 */
	/* istanbul ignore next*/
	function _err(err, context) {
	    console.log("ERROR:", err, " CONTEXT", context);
	}

	/**
	 * The default format for Splunk Enterprise or Splunk Cloud events.
	 *
	 * This function can be overwritten, and can return any type (string, object, array, and so on).
	 *
	 * @param {anything} [message] - The event message.
	 * @param {string} [severity] - The event severity.
	 * @return {any} The event format to send to Splunk,
	 */
	function _defaultEventFormatter(message, severity) {
	    var event = {
	        message: message,
	        severity: severity
	    };
	    return event;
	}

	/**
	 * Constructs a SplunkLogger, to send events to Splunk Enterprise or Splunk Cloud
	 * via HTTP Event Collector. See <code>defaultConfig</code> for default
	 * configuration settings.
	 *
	 * @example
	 * var SplunkLogger = require("splunk-logging").Logger;
	 *
	 * var config = {
	 *     token: "your-token-here",
	 *     name: "my application",
	 *     url: "https://splunk.local:8088"
	 * };
	 *
	 * var logger = new SplunkLogger(config);
	 *
	 * @property {object} config - Configuration settings for this <code>SplunkLogger</code> instance.
	 * @param {object} requestOptions - Options to pass to <code>{@link https://github.com/request/request#requestpost|request.post()}</code>.
	 * See the {@link http://github.com/request/request|request documentation} for all available options.
	 * @property {object[]} serializedContextQueue - Queue of serialized <code>context</code> objects to be sent to Splunk Enterprise or Splunk Cloud.
	 * @property {function} eventFormatter - Formats events, returning an event as a string, <code>function(message, severity)</code>.
	 * Can be overwritten, the default event formatter will display event and severity as properties in a JSON object.
	 * @property {function} error - A callback function for errors: <code>function(err, context)</code>.
	 * Defaults to <code>console.log</code> both values;
	 *
	 * @param {object} config - Configuration settings for a new [SplunkLogger]{@link SplunkLogger}.
	 * @param {string} config.token - HTTP Event Collector token, required.
	 * @param {string} [config.name=splunk-javascript-logging/0.9.1] - Name for this logger.
	 * @param {string} [config.host=localhost] - Hostname or IP address of Splunk Enterprise or Splunk Cloud server.
	 * @param {string} [config.maxRetries=0] - How many times to retry when HTTP POST to Splunk Enterprise or Splunk Cloud fails.
	 * @param {string} [config.path=/services/collector/event/1.0] - URL path to send data to on the Splunk Enterprise or Splunk Cloud server.
	 * @param {string} [config.protocol=https] - Protocol used to communicate with the Splunk Enterprise or Splunk Cloud server, <code>http</code> or <code>https</code>.
	 * @param {number} [config.port=8088] - HTTP Event Collector port on the Splunk Enterprise or Splunk Cloud server.
	 * @param {string} [config.url] - URL string to pass to {@link https://nodejs.org/api/url.html#url_url_parsing|url.parse}. This will try to set
	 * <code>host</code>, <code>path</code>, <code>protocol</code>, <code>port</code>, <code>url</code>. Any of these values will be overwritten if
	 * the corresponding property is set on <code>config</code>.
	 * @param {string} [config.level=info] - Logging level to use, will show up as the <code>severity</code> field of an event, see
	 *  [SplunkLogger.levels]{@link SplunkLogger#levels} for common levels.
	 * @param {number} [config.batchInterval=0] - Automatically flush events after this many milliseconds.
	 * When set to a non-positive value, events will be sent one by one. This setting is ignored when non-positive.
	 * @param {number} [config.maxBatchSize=0] - Automatically flush events after the size of queued
	 * events exceeds this many bytes. This setting is ignored when non-positive.
	 * @param {number} [config.maxBatchCount=1] - Automatically flush events after this many
	 * events have been queued. Defaults to flush immediately on sending an event. This setting is ignored when non-positive.
	 * @constructor
	 * @throws Will throw an error if the <code>config</code> parameter is malformed.
	 */
	var SplunkLogger = function(config) {
	    this._timerID = null;
	    this._timerDuration = 0;
	    this.config = this._initializeConfig(config);
	    this.requestOptions = this._initializeRequestOptions();
	    this.serializedContextQueue = [];
	    this.eventsBatchSize = 0;
	    this.eventFormatter = _defaultEventFormatter;
	    this.error = _err;

	    this._enableTimer = utils.bind(this, this._enableTimer);
	    this._disableTimer = utils.bind(this, this._disableTimer);
	    this._initializeConfig = utils.bind(this, this._initializeConfig);
	    this._initializeRequestOptions = utils.bind(this, this._initializeRequestOptions);
	    this._validateMessage = utils.bind(this, this._validateMessage);
	    this._initializeMetadata = utils.bind(this, this._initializeMetadata);
	    this._initializeContext = utils.bind(this, this._initializeContext);
	    this._makeBody = utils.bind(this, this._makeBody);
	    this._post = utils.bind(this, this._post);
	    this._sendEvents = utils.bind(this, this._sendEvents);
	    this.send = utils.bind(this, this.send);
	    this.flush = utils.bind(this, this.flush);
	};

	/**
	 * Enum for common logging levels.
	 *
	 * @default info
	 * @readonly
	 * @enum {string}
	 */
	SplunkLogger.prototype.levels = {
	    DEBUG: "debug",
	    INFO: "info",
	    WARN: "warn",
	    ERROR: "error"
	};

	var defaultConfig = {
	    name: "splunk-javascript-logging/0.9.1",
	    host: "localhost",
	    path: "/services/collector/event/1.0",
	    protocol: "https",
	    port: 8088,
	    level: SplunkLogger.prototype.levels.INFO,
	    maxRetries: 0,
	    batchInterval: 0,
	    maxBatchSize: 0,
	    maxBatchCount: 1
	};

	var defaultRequestOptions = {
	    json: true, // Sets the content-type header to application/json.
	    strictSSL: false
	};

	/**
	 * Disables the interval timer set by <code>this._enableTimer()</code>.
	 *
	 * param {Number} interval - The batch interval.
	 * @private
	 */
	SplunkLogger.prototype._disableTimer = function() {
	    if (this._timerID) {
	        clearInterval(this._timerID);
	        this._timerDuration = 0;
	        this._timerID = null;
	    }
	};

	/**
	 * Configures an interval timer to flush any events in
	 * <code>this.serializedContextQueue</code> at the specified interval.
	 *
	 * param {Number} interval - The batch interval in milliseconds.
	 * @private
	 */
	SplunkLogger.prototype._enableTimer = function(interval) {
	    // Only enable the timer if possible
	    interval = utils.validateNonNegativeInt(interval, "Batch interval");

	    if (this._timerID) {
	        this._disableTimer();
	    }

	    // If batch interval is changed, update the config property
	    if (this.config) {
	        this.config.batchInterval = interval;
	    }

	    this._timerDuration = interval;

	    var that = this;
	    this._timerID = setInterval(function() {
	        if (that.serializedContextQueue.length > 0) {
	            that.flush();
	        }
	    }, interval);
	};

	/**
	 * Sets up the <code>config</code> with any default properties, and/or
	 * config properties set on <code>this.config</code>.
	 *
	 * @return {object} config
	 * @private
	 * @throws Will throw an error if the <code>config</code> parameter is malformed.
	 */
	SplunkLogger.prototype._initializeConfig = function(config) {
	    // Copy over the instance config
	    var ret = utils.copyObject(this.config);

	    if (!config) {
	        throw new Error("Config is required.");
	    }
	    else if (typeof config !== "object") {
	        throw new Error("Config must be an object.");
	    }
	    else if (!ret.hasOwnProperty("token") && !config.hasOwnProperty("token")) {
	        throw new Error("Config object must have a token.");
	    }
	    else if (typeof ret.token !== "string" && typeof config.token !== "string") {
	        throw new Error("Config token must be a string.");
	    }
	    else {
	        // Specifying the url will override host, port, scheme, & path if possible
	        if (config.url) {
	            var parsed = url.parse(config.url);

	            // Ignore the path if it's just "/"
	            var pathIsNotSlash = parsed.path && parsed.path !== "/";

	            if (parsed.protocol) {
	                config.protocol = parsed.protocol.replace(":", "");
	            }
	            if (parsed.port) {
	                config.port = parsed.port;
	            }
	            if (parsed.hostname && parsed.path) {
	                config.host = parsed.hostname;
	                if (pathIsNotSlash) {
	                    config.path = parsed.path;
	                }
	            }
	            else if (pathIsNotSlash) {
	                // If hostname isn't set, but path is assume path is the host
	                config.host = parsed.path;
	            }
	        }

	        // Take the argument's value, then instance value, then the default value
	        ret.token = utils.orByProp("token", config, ret);
	        ret.name = utils.orByProp("name", config, ret, defaultConfig);
	        ret.level = utils.orByProp("level", config, ret, defaultConfig);

	        ret.host = utils.orByProp("host", config, ret, defaultConfig);
	        ret.path = utils.orByProp("path", config, ret, defaultConfig);
	        ret.protocol = utils.orByProp("protocol", config, ret, defaultConfig);
	        ret.port = utils.orByFalseyProp("port", config, ret, defaultConfig);
	        ret.port = utils.validateNonNegativeInt(ret.port, "Port");
	        if (ret.port < 1 || ret.port > 65535) {
	            throw new Error("Port must be an integer between 1 and 65535, found: " + ret.port);
	        }

	        ret.maxRetries = utils.orByProp("maxRetries", config, ret, defaultConfig);
	        ret.maxRetries = utils.validateNonNegativeInt(ret.maxRetries, "Max retries");

	        // Batching settings
	        ret.maxBatchCount = utils.orByFalseyProp("maxBatchCount", config, ret, defaultConfig);
	        ret.maxBatchCount = utils.validateNonNegativeInt(ret.maxBatchCount, "Max batch count");
	        ret.maxBatchSize = utils.orByFalseyProp("maxBatchSize", config, ret, defaultConfig);
	        ret.maxBatchSize = utils.validateNonNegativeInt(ret.maxBatchSize, "Max batch size");
	        ret.batchInterval = utils.orByFalseyProp("batchInterval", config, ret, defaultConfig);
	        ret.batchInterval = utils.validateNonNegativeInt(ret.batchInterval, "Batch interval");

	        // Has the interval timer not started, and needs to be started?
	        var startTimer = !this._timerID && ret.batchInterval > 0;
	        // Has the interval timer already started, and the interval changed to a different duration?
	        var changeTimer = this._timerID && this._timerDuration !== ret.batchInterval && ret.batchInterval > 0;

	        // Enable the timer
	        if (startTimer || changeTimer) {
	            this._enableTimer(ret.batchInterval);
	        }
	        // Disable timer - there is currently a timer, but config says we no longer need a timer
	        else if (this._timerID && (ret.batchInterval <= 0 || this._timerDuration < 0)) {
	            this._disableTimer();
	        }
	    }
	    return ret;
	};

	/**
	 * Initializes request options.
	 *
	 * @param {object} config
	 * @param {object} options - Options to pass to <code>{@link https://github.com/request/request#requestpost|request.post()}</code>.
	 * See the {@link http://github.com/request/request|request documentation} for all available options.
	 * @returns {object} requestOptions
	 * @private
	 */
	SplunkLogger.prototype._initializeRequestOptions = function(options) {
	    var ret = utils.copyObject(options || defaultRequestOptions);

	    if (options) {
	        ret.json = options.hasOwnProperty("json") ? options.json : defaultRequestOptions.json;
	        ret.strictSSL = options.strictSSL || defaultRequestOptions.strictSSL;
	    }

	    ret.headers = ret.headers || {};

	    return ret;
	};

	/**
	 * Throws an error if message is <code>undefined</code> or <code>null</code>.
	 *
	 * @private
	 * @throws Will throw an error if the <code>message</code> parameter is malformed.
	 */
	SplunkLogger.prototype._validateMessage = function(message) {
	    if (typeof message === "undefined" || message === null) {
	        throw new Error("Message argument is required.");
	    }
	    return message;
	};

	/**
	 * Initializes metadata. If <code>context.metadata</code> is false or empty,
	 * return an empty object.
	 *
	 * @param {object} context
	 * @returns {object} metadata
	 * @private
	 */
	SplunkLogger.prototype._initializeMetadata = function(context) {
	    var metadata = {};
	    if (context && context.hasOwnProperty("metadata")) {
	        if (context.metadata.hasOwnProperty("time")) {
	            metadata.time = context.metadata.time;
	        }
	        if (context.metadata.hasOwnProperty("host")) {
	            metadata.host = context.metadata.host;
	        }
	        if (context.metadata.hasOwnProperty("source")) {
	            metadata.source = context.metadata.source;
	        }
	        if (context.metadata.hasOwnProperty("sourcetype")) {
	            metadata.sourcetype = context.metadata.sourcetype;
	        }
	        if (context.metadata.hasOwnProperty("index")) {
	            metadata.index = context.metadata.index;
	        }
	    }
	    return metadata;
	};

	/**
	 * Initializes a context object.
	 *
	 * @param context
	 * @returns {object} context
	 * @throws Will throw an error if the <code>context</code> parameter is malformed.
	 * @private
	 */
	SplunkLogger.prototype._initializeContext = function(context) {
	    if (!context) {
	        throw new Error("Context argument is required.");
	    }
	    else if (typeof context !== "object") {
	        throw new Error("Context argument must be an object.");
	    }
	    else if (!context.hasOwnProperty("message")) {
	        throw new Error("Context argument must have the message property set.");
	    }

	    context.message = this._validateMessage(context.message);

	    context.severity = context.severity || defaultConfig.level;

	    context.metadata = context.metadata || this._initializeMetadata(context);

	    return context;
	};

	/**
	 * Takes anything and puts it in a JS object for the event/1.0 Splunk HTTP Event Collector format.
	 *
	 * @param {object} context
	 * @returns {object}
	 * @private
	 * @throws Will throw an error if the <code>context</code> parameter is malformed.
	 */
	SplunkLogger.prototype._makeBody = function(context) {
	    if (!context) {
	        throw new Error("Context parameter is required.");
	    }

	    var body = this._initializeMetadata(context);
	    var time = utils.formatTime(body.time || Date.now());
	    body.time = time.toString();

	    body.event = this.eventFormatter(context.message, context.severity || defaultConfig.level);
	    return body;
	};

	/**
	 * Makes an HTTP POST to the configured server.
	 *
	 * @param requestOptions
	 * @param {function} callback = A callback function: <code>function(err, response, body)</code>.
	 * @private
	 */
	SplunkLogger.prototype._post = function(requestOptions, callback) {
	    request.post(requestOptions, callback);
	};

	/**
	 * Sends events to Splunk Enterprise or Splunk Cloud, optionally with retries on non-Splunk errors.
	 *
	 * @param context
	 * @param {function} callback - A callback function: <code>function(err, response, body)</code>
	 * @private
	 */
	SplunkLogger.prototype._sendEvents = function(context, callback) {
	    callback = callback || /* istanbul ignore next*/ function(){};

	    // Initialize the config once more to avoid undefined vals below
	    this.config = this._initializeConfig(this.config);

	    // Makes a copy of the request options so we can set the body
	    var requestOptions = this._initializeRequestOptions(this.requestOptions);
	    requestOptions.body = this._validateMessage(context.message);
	    requestOptions.headers["Authorization"] = "Splunk " + this.config.token;
	    // Manually set the content-type header, the default is application/json
	    // since json is set to true.
	    requestOptions.headers["Content-Type"] = "application/x-www-form-urlencoded";
	    requestOptions.url = this.config.protocol + "://" + this.config.host + ":" + this.config.port + this.config.path;

	    // Initialize the context again, right before using it
	    context = this._initializeContext(context);

	    var that = this;

	    var splunkError = null; // Errors returned by Splunk Enterprise or Splunk Cloud
	    var requestError = null; // Any non-Splunk errors

	    // References so we don't have to deal with callback parameters
	    var _response = null;
	    var _body = null;

	    var numRetries = 0;

	    utils.whilst(
	        function() {
	            // Continue if we can (re)try
	            return numRetries++ <= that.config.maxRetries;
	        },
	        function(done) {
	            that._post(requestOptions, function(err, resp, body) {
	                // Store the latest error, response & body
	                splunkError = null;
	                requestError = err;
	                _response = resp;
	                _body = body;

	                // Try to parse an error response from Splunk Enterprise or Splunk Cloud
	                if (!requestError && body && body.code.toString() !== "0") {
	                    splunkError = new Error(body.text);
	                    splunkError.code = body.code;
	                }

	                // Retry if no Splunk error, a non-200 request response, and numRetries hasn't exceeded the limit
	                if (!splunkError && requestError && numRetries <= that.config.maxRetries) {
	                    utils.expBackoff({attempt: numRetries}, done);
	                }
	                else {
	                    // Stop iterating
	                    done(true);
	                }
	            });
	        },
	        function() {
	            // Call error() for a request error or Splunk error
	            if (requestError || splunkError) {
	                that.error(requestError || splunkError, context);
	            }

	            callback(requestError, _response, _body);
	        }
	    );
	};

	/**
	 * Sends or queues data to be sent based on batching settings.
	 * Default behavior is to send immediately.
	 *
	 * @example
	 * var SplunkLogger = require("splunk-logging").Logger;
	 * var config = {
	 *     token: "your-token-here"
	 * };
	 *
	 * var logger = new SplunkLogger(config);
	 *
	 * // Payload to send to HTTP Event Collector.
	 * var payload = {
	 *     message: {
	 *         temperature: "70F",
	 *         chickenCount: 500
	 *     },
	 *     severity: "info",
	 *     metadata: {
	 *         source: "chicken coop",
	 *         sourcetype: "httpevent",
	 *         index: "main",
	 *         host: "farm.local",
	 *     }
	 * };
	 *
	 * // The callback is only used if maxBatchCount=1, or
	 * // batching thresholds have been exceeded.
	 * logger.send(payload, function(err, resp, body) {
	 *     if (err) {
	 *         console.log("error:", err);
	 *     }
	 *     // If successful, body will be { text: 'Success', code: 0 }
	 *     console.log("body", body);
	 * });
	 *
	 * @param {object} context - An object with at least the <code>data</code> property.
	 * @param {(object|string|Array|number|bool)} context.message - Data to send to Splunk.
	 * @param {string} [context.severity=info] - Severity level of this event.
	 * @param {object} [context.metadata] - Metadata for this event.
	 * @param {string} [context.metadata.host] - If not specified, Splunk Enterprise or Splunk Cloud will decide the value.
	 * @param {string} [context.metadata.index] - The Splunk Enterprise or Splunk Cloud index to send data to.
	 * If not specified, Splunk Enterprise or Splunk Cloud will decide the value.
	 * @param {string} [context.metadata.source] - If not specified, Splunk Enterprise or Splunk Cloud will decide the value.
	 * @param {string} [context.metadata.sourcetype] - If not specified, Splunk Enterprise or Splunk Cloud will decide the value.
	 * @param {function} [callback] - A callback function: <code>function(err, response, body)</code>.
	 * @throws Will throw an error if the <code>context</code> parameter is malformed.
	 * @public
	 */
	SplunkLogger.prototype.send = function(context, callback) {
	    context = this._initializeContext(context);

	    // Store the context, and its estimated length
	    var currentEvent = JSON.stringify(this._makeBody(context));
	    this.serializedContextQueue.push(currentEvent);
	    this.eventsBatchSize += Buffer.byteLength(currentEvent, "utf8");

	    var batchOverSize = this.eventsBatchSize > this.config.maxBatchSize && this.config.maxBatchSize > 0;
	    var batchOverCount = this.serializedContextQueue.length >= this.config.maxBatchCount && this.config.maxBatchCount > 0;

	    // Only flush if the queue's byte size is too large, or has too many events
	    if (batchOverSize || batchOverCount) {
	        this.flush(callback || function(){});
	    }
	};

	/**
	 * Manually send all events in <code>this.serializedContextQueue</code> to Splunk Enterprise or Splunk Cloud.
	 *
	 * @param {function} [callback] - A callback function: <code>function(err, response, body)</code>.
	 * @public
	 */
	SplunkLogger.prototype.flush = function(callback) {
	    callback = callback || function(){};

	    // Empty the queue, reset the eventsBatchSize
	    var queue = this.serializedContextQueue;
	    this.serializedContextQueue = [];
	    this.eventsBatchSize = 0;

	    // Send all queued events
	    var data = queue.join("");
	    var context = {
	        message: data
	    };

	    this._sendEvents(context, callback);
	};

	module.exports = SplunkLogger;


/***/ },
/* 8 */
/***/ function(module, exports) {

	module.exports = require("request");

/***/ },
/* 9 */
/***/ function(module, exports) {

	module.exports = require("url");

/***/ },
/* 10 */
/***/ function(module, exports) {

	/**
	 * Utility functions.
	 * @exports utils
	 */
	var utils = {};
	/*
	 * Copyright 2015 Splunk, Inc.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License"): you may
	 * not use this file except in compliance with the License. You may obtain
	 * a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
	 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
	 * License for the specific language governing permissions and limitations
	 * under the License.
	 */


	/* Utility Functions */

	/**
	 * Formats the time for Splunk Enterprise or Splunk Cloud as a the epoch time in seconds.
	 *
	 * @param {(string|number|date)} time - A date string, timestamp, or <code>Date</code> object.
	 * @returns {number|null} Epoch time in seconds, or <code>null</code> if <code>time</code> is malformed.
	 * @static
	 */
	utils.formatTime = function(time) {
	    var cleanTime;

	    // If time is a Date object, return its value.
	    if (time instanceof Date) {
	        time = time.valueOf();
	    }

	    if (!time || time === null) {
	        return null;
	    }

	    // Values with decimals
	    if (time.toString().indexOf(".") !== -1) {
	        cleanTime = parseFloat(time).toFixed(3); // Clean up the extra decimals right away.

	        // A perfect time in milliseconds, with the decimal in the right spot.
	        if (cleanTime.toString().indexOf(".") >= 10) {
	            cleanTime = parseFloat(cleanTime.toString().substring(0, 14)).toFixed(3);
	        }
	    }
	    // Values without decimals
	    else {
	        // A time in milliseconds, no decimal (ex: Date.now()).
	        if (time.toString().length === 13) {
	            cleanTime = (parseFloat(time) / 1000).toFixed(3);
	        }
	        // A time with fewer than expected digits.
	        else if (time.toString().length <= 12) {
	            cleanTime = parseFloat(time).toFixed(3);
	        }
	        // Any other value has more digits than the expected time format, get the first 14.
	        else {
	            cleanTime = parseFloat(time.toString().substring(0, 13)/1000).toFixed(3);
	        }
	    }
	    return cleanTime;
	};

	/**
	 * Converts an iterable into to an array.
	 *
	 * @param {(Array|Object)} iterable - Thing to convert to an <code>Array</code>.
	 * @returns {Array}
	 * @static
	 */
	utils.toArray = function(iterable) {
	    return Array.prototype.slice.call(iterable);
	};

	// TODO: this isn't used anymore, remove it
	/**
	 * Run async function in a chain, like {@link https://github.com/caolan/async#waterfall|Async.waterfall}.
	 *
	 * @param {(function[]|function)} tasks - <code>Array</code> of callback functions.
	 * @param {function} [callback] - Final callback.
	 * @static
	 */
	utils.chain = function(tasks, callback) {
	    // Allow for just a list of functions
	    if (arguments.length > 1 && typeof arguments[0] === "function") {
	        var args = utils.toArray(arguments);
	        tasks = args.slice(0, args.length - 1);
	        callback = args[args.length - 1];
	    }

	    tasks = tasks || [];
	    callback = callback || function() {};

	    if (tasks.length === 0) {
	        callback();
	    }
	    else {
	        var nextTask = function(task, remainingTasks, result) {
	            var taskCallback = function(err) {
	                if (err) {
	                    callback(err);
	                }
	                else {
	                    var args = utils.toArray(arguments);
	                    args.shift();
	                    nextTask(remainingTasks[0], remainingTasks.slice(1), args);
	                }
	            };

	            var args = result;
	            if (remainingTasks.length === 0) {
	                args.push(callback);
	            }
	            else {
	                args.push(taskCallback);
	            }

	            task.apply(null, args);
	        };

	        nextTask(tasks[0], tasks.slice(1), []);
	    }
	};

	/**
	 * Asynchronous while loop.
	 *
	 * @param {function} [condition] - A function returning a boolean, the loop condition.
	 * @param {function} [body] - A function, the loop body.
	 * @param {function} [callback] - Final callback.
	 * @static
	 */
	utils.whilst = function (condition, body, callback) {
	    condition = condition || function() { return false; };
	    body = body || function(done){ done(); };
	    callback = callback || function() {};

	    var wrappedCallback = function(err) {
	        if (err) {
	            callback(err);
	        }
	        else {
	            utils.whilst(condition, body, callback);
	        }
	    };

	    if (condition()) {
	        body(wrappedCallback);
	    }
	    else {
	        callback(null);
	    }
	};

	/**
	 * Waits using exponential backoff.
	 *
	 * @param {object} [opts] - Settings for this function. Expected keys: attempt, rand.
	 * @param {function} [callback] - A callback function: <code>function(err, timeout)</code>.
	 */
	utils.expBackoff = function(opts, callback) {
	    callback = callback || function(){};
	    if (!opts || typeof opts !== "object") {
	        callback(new Error("Must send opts as an object."));
	    }
	    else if (opts && !opts.hasOwnProperty("attempt")) {
	        callback(new Error("Must set opts.attempt."));
	    }
	    else {

	        var min = 10;
	        var max = 1000 * 60 * 2; // 2 minutes is a reasonable max delay

	        var rand = Math.random();
	        if (opts.hasOwnProperty("rand")) {
	            rand = opts.rand;
	        }
	        rand++;

	        var timeout = Math.round(rand * min * Math.pow(2, opts.attempt));

	        timeout = Math.min(timeout, max);
	        setTimeout(
	            function() {
	                callback(null, timeout);
	            },
	            timeout
	        );
	    }
	};

	/**
	 * Binds a function to an instance of an object.
	 *
	 * @param {object} [self] - An object to bind the <code>fn</code> function parameter to.
	 * @param {object} [fn] - A function to bind to the <code>self</code> argument.
	 * @returns {function}
	 * @static
	 */
	utils.bind = function(self, fn) {
	    return function () {
	        return fn.apply(self, arguments);
	    };
	};

	/**
	 * Copies all properties into a new object which is returned.
	 *
	 * @param {object} [obj] - Object to copy properties from.
	 */
	utils.copyObject = function(obj) {
	    var ret = {};
	    for (var key in obj) {
	        if (obj.hasOwnProperty(key)) {
	            ret[key] = obj[key];
	        }
	    }
	    return ret;
	};

	/**
	 * Copies all elements into a new array, which is returned.
	 *
	 * @param {array} [arr] - Array to copy elements from.
	 * @returns {array}
	 * @static
	 */
	utils.copyArray = function(arr) {
	    var ret = [];
	    for (var i = 0; arr && i < arr.length; i++) {
	        ret[i] = arr[i];
	    }
	    return ret;
	};

	/**
	 * Takes a property name, then any number of objects as arguments
	 * and performs logical OR operations on them one at a time
	 * Returns true as soon as a truthy
	 * value is found, else returning false.
	 *
	 * @param {string} [prop] - property name for other arguments.
	 * @returns {boolean}
	 * @static
	 */
	utils.orByProp = function(prop) {
	    var ret = false;
	    for (var i = 1; !ret && i < arguments.length; i++) {
	        if (arguments[i]) {
	            ret = ret || arguments[i][prop];
	        }
	    }
	    return ret;
	};

	/**
	 * Like <code>utils.orByProp()</code> but for a falsey property.
	 * The first argument after <code>prop</code> with that property
	 * defined will be returned.
	 * Useful for Booleans and numbers.
	 *
	 * @param {string} [prop] - property name for other arguments.
	 * @returns {boolean}
	 * @static
	 */
	utils.orByFalseyProp = function(prop) {
	    var ret = null;
	    // Logic is reversed here, first value wins
	    for (var i = arguments.length - 1; i > 0; i--) {
	        if (arguments[i] && arguments[i].hasOwnProperty(prop)) {
	            ret = arguments[i][prop];
	        }
	    }
	    return ret;
	};

	 /**
	  * Tries to validate the <code>value</code> parameter as a non-negative
	  * integer.
	  *
	  * @param {number} [value] - Some value, expected to be a positive integer.
	  * @param {number} [label] - Human readable name for <code>value</code>
	  * for error messages.
	  * @returns {number}
	  * @throws Will throw an error if the <code>value</code> parameter cannot by parsed as an integer.
	  * @static
	  */
	utils.validateNonNegativeInt = function(value, label) {
	    value = parseInt(value, 10);
	    if (isNaN(value)) {
	        throw new Error(label + " must be a number, found: " + value);
	    }
	    else if (value < 0) {
	        throw new Error(label + " must be a positive number, found: " + value);
	    }
	    return value;
	};

	module.exports = utils;


/***/ },
/* 11 */
/***/ function(module, exports, __webpack_require__) {

	const LRU        = __webpack_require__(12);
	const _          = __webpack_require__(13);
	const lru_params = [ 'max', 'maxAge', 'length', 'dispose', 'stale' ];

	module.exports = function (options) {
	  const cache      = new LRU(_.pick(options, lru_params));
	  const load       = options.load;
	  const hash       = options.hash;
	  const bypass     = options.bypass;
	  const itemMaxAge = options.itemMaxAge;
	  const loading    = new Map();

	  if (options.disable) {
	    return load;
	  }

	  const result = function () {
	    const args       = _.toArray(arguments);
	    const parameters = args.slice(0, -1);
	    const callback   = args.slice(-1).pop();
	    const self       = this;

	    var key;

	    if (bypass && bypass.apply(self, parameters)) {
	      return load.apply(self, args);
	    }

	    if (parameters.length === 0 && !hash) {
	      //the load function only receives callback.
	      key = '_';
	    } else {
	      key = hash.apply(self, parameters);
	    }

	    var fromCache = cache.get(key);

	    if (fromCache) {
	      return callback.apply(null, [null].concat(fromCache));
	    }

	    if (!loading.get(key)) {
	      loading.set(key, []);

	      load.apply(self, parameters.concat(function (err) {
	        const args = _.toArray(arguments);

	        //we store the result only if the load didn't fail.
	        if (!err) {
	          const result = args.slice(1);
	          if (itemMaxAge) {
	            cache.set(key, result, itemMaxAge.apply(self, parameters.concat(result)));
	          } else {
	            cache.set(key, result);
	          }
	        }

	        //immediately call every other callback waiting
	        loading.get(key).forEach(function (callback) {
	          callback.apply(null, args);
	        });

	        loading.delete(key);
	        /////////

	        callback.apply(null, args);
	      }));
	    } else {
	      loading.get(key).push(callback);
	    }
	  };

	  result.keys = cache.keys.bind(cache);

	  return result;
	};


	module.exports.sync = function (options) {
	  const cache = new LRU(_.pick(options, lru_params));
	  const load = options.load;
	  const hash = options.hash;
	  const disable = options.disable;
	  const bypass = options.bypass;
	  const self = this;
	  const itemMaxAge = options.itemMaxAge;

	  if (disable) {
	    return load;
	  }

	  const result = function () {
	    var args = _.toArray(arguments);

	    if (bypass && bypass.apply(self, arguments)) {
	      return load.apply(self, arguments);
	    }

	    var key = hash.apply(self, args);

	    var fromCache = cache.get(key);

	    if (fromCache) {
	      return fromCache;
	    }

	    const result = load.apply(self, args);
	    if (itemMaxAge) {
	      cache.set(key, result, itemMaxAge.apply(self, args.concat([ result ])));
	    } else {
	      cache.set(key, result);
	    }

	    return result;
	  };

	  result.keys = cache.keys.bind(cache);

	  return result;
	};


/***/ },
/* 12 */
/***/ function(module, exports) {

	module.exports = require("lru-cache");

/***/ },
/* 13 */
/***/ function(module, exports) {

	module.exports = require('lodash');

/***/ }
/******/ ]);
