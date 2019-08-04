/* jshint -W097 */
/* jshint strict:false */
/*jslint node: true */
/*jshint -W061 */
"use strict";

/*
 * Created with @iobroker/create-adapter v1.15.1 
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const fs = require("fs");
const LE = require(utils.controllerDir + '/lib/letsencrypt.js');

const safeJsonStringify = require('./lib/json');

class YandexSmartHome extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super(Object.assign({}, options, {
            name: "yandex_smart_home",
        }));
        this.on("ready", this.onReady.bind(this));
        this.on("objectChange", this.onObjectChange.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.webServer = null;
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady() {
        // Initialize your adapter here
        this.webServer = this.initWebServer({
            port: this.config.port,
            prefix: this.config.prefix,
            iotInstance: this.config.iotInstance
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed object changes
     * @param {string} id
     * @param {ioBroker.Object | null | undefined} obj
     */
    onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${safeJsonStringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.message" property to be set to true in io-package.json
     * @param {ioBroker.Message} obj
     */
    onMessage(obj) {
        if (typeof obj === "object" && obj.message) {
            if (obj.command === "send") {
                // e.g. send email or pushover or whatever
                this.log.info("send command");

                // Send response in callback if required
                if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
            }
        }
    }

    doResponse(res, type, status, _headers, content, pretty) {
        status = parseInt(status, 10) || 200;

        if (pretty && typeof content === 'object') {
            type = 'plain';
            content = JSON.stringify(content, null, 2);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

        switch (type) {
            case 'json':
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.statusCode = status;
                res.end(JSON.stringify(content), 'utf8');
                break;

            case 'plain':
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.statusCode = status;
                if (typeof content === 'object') {
                    content = JSON.stringify(content);
                }

                res.end(content, 'utf8');
                break;
            case 'html':
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.statusCode = status;
                if (typeof content === 'object') {
                    content = JSON.stringify(content);
                }

                res.end(content, 'utf8');
                break;
        }
    }

    requestProcessor(req, res) {
        if (req.url.indexOf('favicon.ico') !== -1) {
            const stat = fs.statSync(__dirname + '/admin/favicon.ico');
    
            res.writeHead(200, {
                'Content-Type': 'image/x-icon',
                'Content-Length': stat.size
            });
    
            const readStream = fs.createReadStream(__dirname + '/admin/favicon.ico');
            // We replaced all the event handlers with a simple call to readStream.pipe()
            readStream.pipe(res);
        } else {            
            let values = {};
            let url;
            try {
                url = decodeURI(req.url);
            }
            catch (e) {
                url = req.url;
            }
            const pos = url.indexOf('?');
            if (pos !== -1) {
                const arr = url.substring(pos + 1).split('&');
                url = url.substring(0, pos);

                for (let i = 0; i < arr.length; i++) {
                    const _parts = arr[i].split('=');
                    try {
                        _parts[0] = decodeURIComponent(_parts[0]).trim().replace(/%23/g, '#');
                        _parts[1] = _parts[1] === undefined ? null : decodeURIComponent((_parts[1] + '').replace(/\+/g, '%20'));
                        values[_parts[0]] = _parts[1];
                    } catch (e) {
                        values[_parts[0]] = _parts[1];
                    }
                }
            }

            const command = url.replace(this.prefix, '');
            this.log.debug(command);

            if (req.method === 'POST') {
                let body = '';
                req.on('data', data => body += data);
                req.on('end', () => {
                    this.log.debug(body);
                    try {
                        values = JSON.parse(body);
                    } catch (e) {
                        this.log.debug(`Error json parsing ${body}`);
                    }
                    this.processCommand(req, res, command, values);
                });
            } else {
                this.processCommand(req, res, command, values);
            }
        }
    }

    processCommand(req, res, command, values) {
        switch (command) {
            // GET
            // https://yandex.ru/dev/dialogs/alice/doc/auth/account-linking-docpage/
            case '/auth':
                const authResult = '<!DOCTYPE html><html class="i-ua_js_no i-ua_css_standard" lang="ru"><head><meta name="viewport" content="width=device-width, height=device-height initial-scale=1 user-scalable=no">' +
                '<body style="background:#310d80;">' +
                '<footer style="position:fixed; bottom:0; left:0; right:0; padding:24px 16px;">' +
                '<a style="display:block; text-align:center; background:#7b3dcc; color:#fff; cursor:pointer; font-family:Arial,sans-serif; font-size:20px; padding:13px 16px; border-radius:6px; text-decoration:none;" href="' + values.redirect_uri + '?code=test123&state=' + values.state + '">Подключить умный дом</a></footer></body></html>';
                this.doResponse(res, 'html', 200, {'Access-Control-Allow-Origin': '*'}, authResult, false);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/check-docpage/
            case '/v1.0':
                this.doResponse(res, 'json', 200, {'Access-Control-Allow-Origin': '*'});
                break;

            // POST
            case '/token':
                let tokenResult = {"access_token": "acceess123456789", "token_type": "bearer", "expires_in": 2592000, "refresh_token": "refresh123456789"};
                this.doResponse(res, 'json', 200, {'Access-Control-Allow-Origin': '*'}, tokenResult, true);
                break;
                
            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/unlink-docpage/
            case '/v1.0/user/unlink':
                this.doResponse(res, 'json', 200, {'Access-Control-Allow-Origin': '*'});
                break;
            
            default:
                const OBJECT_FROM_ALISA_SERVICE = values || {}; // object from alisa service or empty object
                OBJECT_FROM_ALISA_SERVICE.alisa = command;
                this.sendTo(this.iotInstance, 'private', {type: 'alisa', request: OBJECT_FROM_ALISA_SERVICE}, response => {
                    // Send this response back to alisa service
                    this.log.debug(JSON.stringify(response));
                    this.doResponse(res, 'json', 200, {'Access-Control-Allow-Origin': '*'}, response); 
                });
                break;
        }
    }
    
    initWebServer(settings) {
        //this.log.debug(`${JSON.stringify(settings)}`);
        let server;
        settings.port = parseInt(settings.port, 10);
        this.prefix = settings.prefix;
        this.iotInstance = settings.iotInstance;

    
        if (settings.port) {
            if (settings.secure && !this.config.certificates) return null;
    
            server = LE.createServer(this.requestProcessor.bind(this), settings, this.config.certificates, 
                this.config.leConfig, this.log);
        } else {
            this.log.error('port missing');
            //if (this.terminate) {
            //    this.terminate('sss', 1);
            // } else {
            //     process.exit(1);
            //}
        }
    
        if (server) {
            this.getPort(settings.port, port => {
                if (port !== settings.port && !this.config.findNextPort) {
                    this.log.error('port ' + settings.port + ' already in use');
                    if (this.terminate) {
                        this.terminate(1);
                    } else {
                        process.exit(1);
                    }
                }
                server.listen(port);
                this.log.info('http' + (settings.secure ? 's' : '') + ' server listening on port ' + port);
                this.log.info(`with prefix "${this.prefix}"`);
                this.log.info(`send to "${this.iotInstance}"`);
            });
        }
    
        if (server) {
            return server;
        } else {
            return null;
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new YandexSmartHome(options);
} else {
    // otherwise start the instance directly
    new YandexSmartHome();
}