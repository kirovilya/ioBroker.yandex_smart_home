/* jshint -W097 */
/* jshint strict:false */
/*jslint node: true */
/*jshint -W061 */
'use strict';

const safeJsonStringify = require('./json');
    
const device = require('./device');

/**
 * SimpleAPI class
 *
 * From settings used only secure, auth and crossDomain
 *
 * @class
 * @param {object} server http or https node.js object
 * @param {object} webSettings settings of the web server, like <pre><code>{secure: settings.secure, port: settings.port}</code></pre>
 * @param {object} adapter web adapter object
 * @param {object} instanceSettings instance object with common and native
 * @param {object} app express application
 * @return {object} object instance
 */
function SimpleAPI(server, webSettings, adapter, instanceSettings, app) {
    if (!(this instanceof SimpleAPI)) return new SimpleAPI(server, webSettings, adapter, instanceSettings, app);

    //this.server    = server;
    this.app = app;
    this.adapter = adapter;
    this.settings = webSettings;
    this.config = instanceSettings ? instanceSettings.native : {};
    this.namespace = instanceSettings ? instanceSettings._id.substring('system.adapter.'.length) : 'simple-api';

    this.restApiDelayed = {
        timer: null,
        responseType: '',
        response: null,
        waitId: 0
    };

    const that = this;
    // Cache
    this.users = {};

    const __construct = (function () {
        that.adapter.log.info((that.settings.secure ? 'Secure ' : '') + 'simpleAPI server listening on port ' + that.settings.port);
        that.adapter.config.defaultUser = that.adapter.config.defaultUser || 'system.user.admin';
        if (!that.adapter.config.defaultUser.match(/^system\.user\./)) {
            that.adapter.config.defaultUser = 'system.user.' + that.adapter.config.defaultUser;
        }
        if (that.adapter.config.onlyAllowWhenUserIsOwner === undefined) that.adapter.config.onlyAllowWhenUserIsOwner = false;
        adapter.log.info('Allow states only when user is owner: ' + that.adapter.config.onlyAllowWhenUserIsOwner);

        if (that.app) {
            adapter.log.info('Install extension on /' + that.namespace + '/');
            that.app.use('/' + that.namespace + '/', (req, res, next) => that.restApi.call(that, req, res));

            // let it be accessible under old address too
            for (const c in commandsPermissions) {
                (function (command) {
                    adapter.log.info('Install extension on /' + command + '/');
                    that.app.use('/' + command + '/', (req, res, next) => {
                        req.url = '/' + command + req.url;
                        that.restApi.call(that, req, res);
                    });
                })(c);
            }
        }
        // Subscribe on user changes to manage the permissions cache
        that.adapter.subscribeForeignObjects('system.group.*');
        that.adapter.subscribeForeignObjects('system.user.*');
    }.bind(this))();

    this.isAuthenticated = function (values, callback) {
        if (!values.user || !values.pass) {
            that.adapter.log.warn('No password or username!');
            callback(false);
        } else {
            that.adapter.checkPassword(values.user, values.pass, res => {
                if (res) {
                    that.adapter.log.debug('Logged in: ' + values.user);
                    callback(true);
                } else {
                    that.adapter.log.warn('Invalid password or user name: ' + values.user);
                    callback(false);
                }
            });
        }
    };

    this.stateChange = function (id, state) {
        if (that.restApiDelayed.id === id && state && state.ack) {
            adapter.unsubscribeForeignStates(id);
            that.restApiDelayed.response = state;
            setTimeout(restApiDelayedAnswer, 0);
        }
    };

    this.userReg = new RegExp('^system\.user\.');
    this.groupReg = new RegExp('^system\.group\.');

    // if user politics changes, clear cache
    this.objectChange = function (id, state) {
        if (this.userReg.test(id) || this.groupReg.test(id)) {
            this.users = {};
        }
    };

    function restApiPost(req, res, command, oId, values) {
        const responseType = 'json';
        let status = 500;
        const headers = {'Access-Control-Allow-Origin': '*'};

        let body = '';
        req.on('data', data => body += data);
        req.on('end', () => {
            switch (command) {
                case '/token':
                    status = 200;
                    let tokenResult = { "access_token": "acceess123456789", "token_type": "bearer", "expires_in": 2592000, "refresh_token": "refresh123456789" };
                    doResponse(res, responseType, status, headers, tokenResult, true);
                    break;
                    
                // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/unlink-docpage/
                case '/v1.0/user/unlink':
                    doResponse(res, responseType, 200, headers);
                    break;

                // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/post-devices-query-docpage/
                case '/v1.0/user/devices/query':
                    status = 200;
                    let queryResult = {};
                    doResponse(res, responseType, status, headers, queryResult, true);
                    break;

                // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/post-action-docpage/
                case '/v1.0/user/devices/action':
                    status = 200;
                    let actionResult = {};
                    doResponse(res, responseType, status, headers, actionResult, true);
                    break;

                default:
                    doResponse(res, responseType, status, headers, {error: 'command ' + command + ' unknown'}, values.prettyPrint);
                    break;
            }
        });
    }

    function restApiDelayedAnswer() {
        if (that.restApiDelayed.timer) {
            clearTimeout(that.restApiDelayed.timer);
            that.restApiDelayed.timer = null;

            doResponse(that.restApiDelayed.res, that.restApiDelayed.responseType, 200, {'Access-Control-Allow-Origin': '*'}, that.restApiDelayed.response, that.restApiDelayed.prettyPrint);
            that.restApiDelayed.id = null;
            that.restApiDelayed.res = null;
            that.restApiDelayed.response = null;
            that.restApiDelayed.prettyPrint = false;
        }
    }

    function findState(idOrName, user, type, callback) {
        if (typeof type === 'function') {
            callback = type;
            type = null;
        }
        adapter.findForeignObject(idOrName, type, {user: user, checked: true}, callback);
    }

    function getState(idOrName, user, type, callback) {
        if (typeof type === 'function') {
            callback = type;
            type = null;
        }
        findState(idOrName, user, type, (err, id, originId) => {
            console.error('OBJECT1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' + err + ' '  + id)
            if (err) {
                callback && callback(err, undefined, null, originId);
            } else if (id) {
                that.adapter.getForeignState(id, {
                    user: user,
                    limitToOwnerRights: that.adapter.config.onlyAllowWhenUserIsOwner
                }, (err, obj) => {
                    console.error('OBJECT!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' + JSON.stringify(obj))
                    if (err || !obj) {
                        obj = undefined;
                    }
                    callback && callback(err, obj, id, originId);
                });
            } else {
                callback && callback(null, undefined, null, originId);
            }
        });
    }

    function doResponse(res, type, status, _headers, content, pretty) {
        //if (!headers) headers = {};

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
        that.adapter.log.debug(`response: ${safeJsonStringify(res)}`);
        that.adapter.log.debug(`response content: ${safeJsonStringify(content)}`);
    }

    // static information
    const commandsPermissions = {
        getPlainValue: {type: 'state', operation: 'read'},
        get: {type: 'state', operation: 'read'},
        getBulk: {type: 'state', operation: 'read'},
        set: {type: 'state', operation: 'write'},
        toggle: {type: 'state', operation: 'write'},
        setBulk: {type: 'state', operation: 'write'},
        setValueFromBody: {type: 'state', operation: 'write'},
        getObjects: {type: 'object', operation: 'list'},
        objects: {type: 'object', operation: 'list'},
        states: {type: 'state', operation: 'list'},
        getStates: {type: 'state', operation: 'list'},
        help: {type: '', operation: ''}
    };

    this.commands = [];
    for (const c in commandsPermissions) {
        this.commands.push(c);
    }
    // Register api by express
    this.checkRequest = function (url) {
        const parts = url.split('/', 2);
        return (parts[1] && this.commands.indexOf(parts[1]) !== -1);
    };

    this.checkPermissions = function (user, command, callback) {
        adapter.calculatePermissions(user, commandsPermissions, acl => {
            if (user !== 'system.user.admin') {
                // type: file, object, state, other
                // operation: create, read, write, list, delete, sendto, execute, sendto
                if (commandsPermissions[command]) {
                    // If permission required
                    if (commandsPermissions[command].type) {
                        if (acl[commandsPermissions[command].type] &&
                            acl[commandsPermissions[command].type][commandsPermissions[command].operation]) {
                            return callback(null);
                        }
                    } else {
                        return callback(null);
                    }
                }

                that.adapter.log.warn('No permission for "' + user + '" to call ' + command);

                if (callback) callback('permissionError');
            } else {
                return callback(null);
            }
        });
    };

    this.restApi = function (req, res, isAuth, isChecked) {
        const values = {};
        let oId = [];
        let wait = 0;
        let responseType = 'json';
        let status = 500;
        const headers = {'Access-Control-Allow-Origin': '*'};
        let response;

        that.adapter.log.debug(`request: ${safeJsonStringify(req)}`);

        let url;
        try {
            url = decodeURI(req.url);
        }
        catch (e) {
            url = req.url;
            that.adapter.log.warn('Malformed URL encoding: ' + e);
        }
        
        that.adapter.log.debug(`request url ${url}`);

        const pos = url.indexOf('?');
        if (pos !== -1) {
            const arr = url.substring(pos + 1).split('&');
            url = url.substring(0, pos);

            for (let i = 0; i < arr.length; i++) {
                const _parts = arr[i].split('=');
                //that.adapter.log.debug('Try Decode ' + i + ': ' + arr[i][1]);
                try {
                    _parts[0] = decodeURIComponent(_parts[0]).trim().replace(/%23/g, '#');
                    _parts[1] = _parts[1] === undefined ? null : decodeURIComponent((_parts[1] + '').replace(/\+/g, '%20'));
                    values[_parts[0]] = _parts[1];
                } catch (e) {
                    values[_parts[0]] = _parts[1];
                }
                //that.adapter.log.debug('    Decode Result ' + i + ': ' + values[arr[i][0].trim()]);
            }
            if (values.prettyPrint !== undefined) {
                if (values.prettyPrint === 'false') values.prettyPrint = false;
                if (values.prettyPrint === null) values.prettyPrint = true;
            }
            // Default value for wait
            if (values.wait === null) {
                values.wait = 2000;
            }
        }

        const command = url.replace('/dacha', '');

        that.adapter.log.debug(`request values: ${safeJsonStringify(values)}`);

        // If authentication check is required
        if (that.settings.auth) {
            if (!isAuth) {
                this.isAuthenticated(values, isAuth => {
                    if (isAuth) {
                        that.restApi(req, res, true);
                    } else {
                        doResponse(res, 'plain', 401, headers, 'error: authentication failed. Please write "http' + (that.settings.secure ? 's' : '') + '://' + req.headers.host + '?user=UserName&pass=Password"');
                    }
                });
                return;
            } else if (!isChecked) {
                if (!values.user.match(/^system\.user\./)) values.user = 'system.user.' + values.user;
                that.checkPermissions(values.user, command, err => {
                    if (!err) {
                        that.restApi(req, res, true, true);
                    } else {
                        doResponse(res, 'plain', 401, headers, 'error: ' + err, values.prettyPrint);
                    }
                });
                return;
            }
        } else {
            req.user = req.user || that.adapter.config.defaultUser;
            values.user = req.user;
            if (!values.user.match(/^system\.user\./)) values.user = 'system.user.' + values.user;
            if (!isChecked && command) {
                that.checkPermissions(req.user || that.adapter.config.defaultUser, command, err => {
                    if (!err) {
                        that.restApi(req, res, true, true);
                    } else {
                        doResponse(res, 'plain', 401, headers, 'error: ' + err, values.prettyPrint);
                    }
                });
                return;
            }
        }
        if (!values.user.match(/^system\.user\./)) values.user = 'system.user.' + values.user;

        if (req.method === 'POST') {
            restApiPost(req, res, command, oId, values);
            return;
        }

        switch (command) {
            // https://yandex.ru/dev/dialogs/alice/doc/auth/account-linking-docpage/
            case '/auth':
                status = 200;
                const authResult = '<!DOCTYPE html><html class="i-ua_js_no i-ua_css_standard" lang="ru"><head><meta name="viewport" content="width=device-width, height=device-height initial-scale=1 user-scalable=no">' +
                '<body style="background:#310d80;">' +
                '<footer style="position:fixed; bottom:0; left:0; right:0; padding:24px 16px;">' +
                '<a style="display:block; text-align:center; background:#7b3dcc; color:#fff; cursor:pointer; font-family:Arial,sans-serif; font-size:20px; padding:13px 16px; border-radius:6px; text-decoration:none;" href="' + values.redirect_uri + '?code=test123&state=' + values.state + '">Подключить умный дом</a></footer></body></html>';
                doResponse(res, 'html', status, headers, authResult, false);
                break;

            case '/token':
                status = 200;
                let tokenResult = { "access_token": "acceess123456789", "token_type": "bearer", "expires_in": 2592000, "refresh_token": "refresh123456789" };
                doResponse(res, responseType, status, headers, tokenResult, true);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/check-docpage/
            case '/v1.0':
                doResponse(res, responseType, 200, headers);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/get-devices-docpage/
            case '/v1.0/user/devices':
                status = 200;
                const devices = [
                    new device({
                        id: 1,
                        name: 'Свет',
                        room: 'Комната',
                        type: 'devices.types.light',
                    }),

                    new device({
                        id: 2,
                        name: 'Свет',
                        room: 'Кухня',
                        type: 'devices.types.light',
                    }),

                    new device({
                        id: 3,
                        name: 'Вытяжка',
                        room: 'Кухня',
                        type: 'devices.types.socket',
                    }),
                ];
                const devicesResult = {
                    request_id: "1",
                    payload: {
                      user_id: "1",
                      devices: []
                    }
                };
                for (var i in devices) {
                    devicesResult.payload.devices.push(devices[i].getInfo());
                }
                doResponse(res, responseType, status, headers, devicesResult, true);
                break;

            case '/help':
            // is default behaviour too
            default:
                const obj = (command === 'help') ? {} : {error: 'command ' + command + ' unknown'};
                let request = 'http' + (that.settings.secure ? 's' : '') + '://' + req.headers.host;
                if (this.app) {
                    request += '/' + this.namespace + '/';
                }
                let auth = '';
                if (that.settings.auth) {
                    auth = 'user=UserName&pass=Password';
                }

                doResponse(res, responseType, status, headers, obj, true);
                break;
        }
    };
}

module.exports = SimpleAPI;