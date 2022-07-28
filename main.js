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
var https  = require('https');
const { adapter } = require("@iobroker/adapter-core");
const WebSocket = require('ws').WebSocket;
const uuid = require('uuid/v4');
const axios = require('axios');
const { Scanner, Services } = require('mdns-scanner');


class YandexSession {
    constructor(adapter) {
        this.adapter = adapter;
    }

    refreshSession() {
        return axios.get("https://yandex.ru/quasar?storage=1", {validateStatus: status => status === 200}
            ).then(response => {
                this.adapter.log.debug(`refreshSession: ${JSON.stringify(response.data)}`);
                const uid = response.data['storage']['user']['uid'];
                if (uid) {
                    return true;
                } else {
                    const ok = this.loginToken(this.adapter.config.x_token);
                    // if (ok) {
                    //     this.update();
                    // }
                    return ok;
                }
            }).catch(error => {
                let errorMessage;
                if (error.response) {
                    errorMessage = error.response.data || error.response.status;
                } else if (error.request) {
                    errorMessage = 'No answer';
                } else {
                    errorMessage = error.message;
                }
                this.adapter.log.error('refreshSession error: ' + errorMessage);
            });
    }

    loginToken(token) {
        this.adapter.log.debug(`Login with token ${token}`);
        return axios.post("https://mobileproxy.passport.yandex.net/1/bundle/auth/x_token/", 
            {
                'type': 'x-token',
                'retpath': 'https://www.yandex.ru'
            },
            {
                headers: {'Ya-Consumer-Authorization': `OAuth ${token}`},
                //validateStatus: status => status === 200
            }).then(response => {
                this.adapter.log.debug(`loginToken: ${JSON.stringify(response.data)}`);
                const status = response.data['status'];
                if (status != 'ok') {
                    this.adapter.log.error('loginToken error status: ' + response.data);
                    return false;
                }
                const host = response.data['passport_host'];
                const trackId = response.data['track_id'];
                return axios.get(`${host}/auth/session/`, 
                    {
                        params: {track_id: trackId},
                        maxRedirects: 0,
                        validateStatus: status => status != 302
                    }).then(response => {return true});
            }).catch(error => {
                let errorMessage;
                if (error.response) {
                    errorMessage = error.response.data || error.response.status;
                } else if (error.request) {
                    errorMessage = 'No answer';
                } else {
                    errorMessage = error.message;
                }
                this.adapter.log.error('loginToken error: ' + errorMessage);
            });
    }

    loginUsername() {
        // const r = https.request(options, function (res) {
        //     let message = '', data = '';
        //     res.on('data', (chunk) => {
        //         message += chunk;
        //     });
        //     res.on('end', function() {
        //         if ([202, 200].indexOf(res.statusCode) >= 0) {
        //             adapter.log.debug(message);
        //         } else {
        //             adapter.log.error(res.statusMessage);
        //             adapter.log.error(message);
        //         }
        //     });
        // });
        // r.on('error', function (res) {
        //     adapter.log.error('request failure: '+res.message);
        // });
    }
}


class YandexQuasar {
    constructor(session) {
        this.session = session;
    }
    init() {
        
    }
}


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
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.webServer = null;
        this.session = new YandexSession(this);
        // this.wsclient = new WebSocket('wss://10.0.0.2:1961', {
        //     protocolVersion: 8,
        //     origin: 'https://10.0.0.2:1961',
        //     rejectUnauthorized: false
        // });
        // this.wsclient.on('open', function() {
        //     const wsdata = {
        //         'conversationToken': "",
        //         'id': uuid(),
        //         'payload': {'command': 'softwareVersion'},
        //         'sentTime': new Date().getTime() / 1000,
        //     };
        //     this.wsclient.send(JSON.stringify(wsdata));
        // }.bind(this));
        // this.wsclient.on('message', this.wslog.bind(this));
        // this.wsclient.on('ping', this.wslog.bind(this));
        // this.wsclient.on('close', function clear() {});
    }

    wslog(data) {
        this.log.info(data);
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        this.webServer = this.initWebServer({
            port: this.config.port,
            prefix: this.config.prefix,
            iotInstance: this.config.iotInstance
        });
        //this.session.refreshSession();
        const res = await this.scanYandexStations();
        this.log.info(`Found Yandex Stations: ${JSON.stringify(res)}`)
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
                this.log.info(`send command: ${JSON.stringify(obj.message)}`);
                if (obj.message.command === "sendNotify") {
                    this.log.info("send notify");

                    this.sendBackNotify(obj.message.deviceId);

                    // Send response in callback if required
                    if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
                }

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
            case '/v1.0/':
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

    sendBackNotify(deviceId) {
        const adapter = this;
        const OBJECT_FROM_ALISA_SERVICE = {
            "devices": [
                {
                  "id": deviceId,
                },
            ]
        };
        OBJECT_FROM_ALISA_SERVICE.alisa = '/v1.0/user/devices/query';
        this.sendTo(this.iotInstance, 'private', {type: 'alisa', request: OBJECT_FROM_ALISA_SERVICE}, response => {
            if (response) {
                adapter.log.debug(JSON.stringify(response));
                delete response.request_id;
                response.ts = new Date().getTime() / 1000;
                this.sendToYandex(response);
            }
        });
    }

    sendToYandex(data) {
        const adapter = this;
        const postData = JSON.stringify(data);
        const options = {
            host: 'dialogs.yandex.net',
            path: `/api/v1/skills/${this.config.skill_id}/callback/state`,
            method: 'POST',
            headers: {
                'Authorization': `OAuth ${this.config.token}`,
                'Content-Type': 'application/json'
            }
        };
        adapter.log.debug(JSON.stringify(options));
        adapter.log.debug(postData);
        const r = https.request(options, function (res) {
            let message = '', data = '';
            res.on('data', (chunk) => {
                message += chunk;
            });
            res.on('end', function() {
                if ([202, 200].indexOf(res.statusCode) >= 0) {
                    adapter.log.debug(message);
                } else {
                    adapter.log.error(res.statusMessage);
                    adapter.log.error(message);
                }
            });
        });
        r.on('error', function (res) {
            adapter.log.error('request failure: '+res.message);
        });
        if (data) {
            r.write(postData);
            adapter.log.debug(postData);
        }
        r.end();
    }

    scanYandexStations(timeout=15) {
        return new Promise((resolve, reject) => {
            const scanner = new Scanner({ debug: true });
            const services = new Services(scanner);
            services.on('error', error => {
                this.log.error('ERROR EVENT: '+ error);
            }).on('warn', message => {
                this.log.debug('WARN EVENT: '+ message);
            }).on('debug', message => {
                this.log.debug('DEBUG EVENT: '+ message);
            }).on('query', message => {
                this.log.debug('QUERY EVENT: '+ JSON.stringify(message.questions));
            }).on('discovered', message => {
                this.log.debug('DISCOVERED EVENT: '+ JSON.stringify(message));
            });
            // initialize scanner and send a query
            scanner.init()
                .then(ready => {
                    if (!ready) throw new Error('Scanner not ready after init.');
                    scanner.query('_services._dns-sd._udp.local', 'ANY');
                    //scanner.query('_yandexio._tcp.local', 'ANY');
                })
                .catch((error) => {
                    this.log.error('CAUGHT ERROR: '+ error.message);
                    reject();
                });
            // end scan after delay
            setTimeout(() => {
                const types = services.types.slice();
                types.sort();
                this.log.debug('Discovered types:' + JSON.stringify(types));
                const result = [];
                Object.keys(services.namedServices).forEach(name => {
                    this.log.debug(`Service: ${name} from ${services.namedServices[name].rinfo.address}.`);
                    if (services.namedServices[name].service) {
                        this.log.debug('Data:' + JSON.stringify(services.namedServices[name].service.data));
                        if (name.endsWith('_yandexio._tcp.local') || name.endsWith('_linkplay._tcp.local')) {
                            result.push({
                                service: name,
                                ip: services.namedServices[name].rinfo.address,
                                port: services.namedServices[name].service.data['port'],
                                target: services.namedServices[name].service.data['target'],
                            });
                        }
                    }
                });
                scanner.destroy();
                resolve(result);
            }, timeout*1000);
        });
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