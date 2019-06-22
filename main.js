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

const YandexSmartHomeProvider = require('./lib/provider');
const DeviceManager = require('./lib/devmanager');
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

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        //this.log.info("config option1: " + this.config.option1);
        //this.log.info("config option2: " + this.config.option2);

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
        // await this.setObjectAsync("testVariable", {
        //     type: "state",
        //     common: {
        //         name: "testVariable",
        //         type: "boolean",
        //         role: "indicator",
        //         read: true,
        //         write: true,
        //     },
        //     native: {},
        // });

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates("*");

        /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        //await this.setStateAsync("testVariable", true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        //await this.setStateAsync("testVariable", { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        //await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        //let result = await this.checkPasswordAsync("admin", "iobroker");
        //this.log.info("check user admin pw ioboker: " + result);

        //result = await this.checkGroupAsync("admin", "admin");
        //this.log.info("check group user admin group admin: " + result);

        //this.webServer = this.initWebServer(this.config);
        this.devmanager = new DeviceManager(this);
        this.devmanager.getAll();
        
        this.webServer = this.initWebServer({
            port: 8088,
            prefix: "/dacha",
            devmanager: this.devmanager,
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
            this.webServer.api.request(req, res);
        }
    }
    
    initWebServer(settings) {
        const server = {
            app:       null,
            server:    null,
            api:       null,
            io:        null,
            settings:  settings
        };
        //this.log.debug(`${JSON.stringify(settings)}`);
    
        settings.port = parseInt(settings.port, 10);
    
        if (settings.port) {
            if (settings.secure && !this.config.certificates) return null;
    
            server.server = LE.createServer(this.requestProcessor.bind(this), settings, this.config.certificates, 
                this.config.leConfig, this.log);
            server.server.__server = server;
        } else {
            this.log.error('port missing');
            //if (this.terminate) {
            //    this.terminate('sss', 1);
            // } else {
            //     process.exit(1);
            //}
        }
    
        if (server.server) {
            this.getPort(settings.port, port => {
                if (port !== settings.port && !this.config.findNextPort) {
                    this.log.error('port ' + settings.port + ' already in use');
                    if (this.terminate) {
                        this.terminate(1);
                    } else {
                        process.exit(1);
                    }
                }
                server.server.listen(port);
                this.log.info('http' + (settings.secure ? 's' : '') + ' server listening on port ' + port);
            });
        }
    
        server.api = new YandexSmartHomeProvider(this, settings);
    
        if (server.server) {
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