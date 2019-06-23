/* jshint -W097 */
/* jshint strict:false */
/*jslint node: true */
/*jshint -W061 */
'use strict';

const safeJsonStringify = require('./json');
    
class YandexSmarthomeProvider {
    constructor(adapter, settings) {
        this.adapter = adapter;
        this.deviceManager = settings.devmanager;
        this.prefix = settings.prefix || '';

        adapter.log.info((settings.secure ? 'Secure ' : '') + 'YandexSmarthomeProvider server listening on port ' + settings.port);
    }

    request(req, res, isAuth, isChecked) {
        let values = {};
        this.adapter.log.debug(`request: ${safeJsonStringify(req)}`);

        let url;
        try {
            url = decodeURI(req.url);
        }
        catch (e) {
            url = req.url;
            this.adapter.log.warn('Malformed URL encoding: ' + e);
        }
        
        this.adapter.log.debug(`request url ${url}`);

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

        const command = url.replace(this.prefix, '');

        this.adapter.log.debug(`request values: ${safeJsonStringify(values)}`);

        if (req.method === 'POST') {
            let body = '';
            req.on('data', data => body += data);
            req.on('end', () => {
                values = JSON.parse(body);
                this.processCommand(req, res, command, values);
            });
        } else {
            this.processCommand(req, res, command, values);
        }
    }

    processCommand(req, res, command, values) {
        const responseType = 'json';
        let status = 500;
        const headers = {'Access-Control-Allow-Origin': '*'};

        switch (command) {
            // GET
            // https://yandex.ru/dev/dialogs/alice/doc/auth/account-linking-docpage/
            case '/auth':
                status = 200;
                const authResult = '<!DOCTYPE html><html class="i-ua_js_no i-ua_css_standard" lang="ru"><head><meta name="viewport" content="width=device-width, height=device-height initial-scale=1 user-scalable=no">' +
                '<body style="background:#310d80;">' +
                '<footer style="position:fixed; bottom:0; left:0; right:0; padding:24px 16px;">' +
                '<a style="display:block; text-align:center; background:#7b3dcc; color:#fff; cursor:pointer; font-family:Arial,sans-serif; font-size:20px; padding:13px 16px; border-radius:6px; text-decoration:none;" href="' + values.redirect_uri + '?code=test123&state=' + values.state + '">Подключить умный дом</a></footer></body></html>';
                this.doResponse(res, 'html', status, headers, authResult, false);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/check-docpage/
            case '/v1.0':
                this.doResponse(res, responseType, 200, headers);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/get-devices-docpage/
            case '/v1.0/user/devices':
                status = 200;
                this.deviceManager.getSmartDevices().then(devices => {
                    const devicesResult = {
                        request_id: "1",
                        payload: {
                            user_id: "1",
                            devices: devices
                        }
                    };
                    this.doResponse(res, responseType, status, headers, devicesResult, true);
                });
                break;

            // POST
            case '/token':
                status = 200;
                let tokenResult = { "access_token": "acceess123456789", "token_type": "bearer", "expires_in": 2592000, "refresh_token": "refresh123456789" };
                this.doResponse(res, responseType, status, headers, tokenResult, true);
                break;
                
            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/unlink-docpage/
            case '/v1.0/user/unlink':
                this.doResponse(res, responseType, 200, headers);
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/post-devices-query-docpage/
            case '/v1.0/user/devices/query':
                status = 200;
                const queryDevices = values.devices || [];
                const ids = [];
                queryDevices.forEach(element => {
                    ids.push(element.id);
                });
                if (ids) {
                    this.deviceManager.querySmartDevicesByIds(ids).then(devices => {
                        let queryResult = {
                            request_id: "1",
                            payload: {
                                devices: devices
                            }
                        };
                        this.doResponse(res, responseType, status, headers, queryResult, true);
                    });
                } else {
                    this.doResponse(res, responseType, status, headers, null, true);
                }
                break;

            // https://yandex.ru/dev/dialogs/alice/doc/smart-home/reference/post-action-docpage/
            case '/v1.0/user/devices/action':
                status = 200;
                const actionDevices = values.devices || [];
                const result = [];
                actionDevices.forEach(element => {
                    result.push(this.deviceManager.doAction(element));
                });
                Promise.all(result).then((devices) => {
                    let actionResult = {
                        request_id: "1",
                        payload: {
                            devices: devices
                        }
                    };
                    this.doResponse(res, responseType, status, headers, actionResult, true);
                });
                break;

            default:
                this.doResponse(res, responseType, status, headers, {error: 'command ' + command + ' unknown'}, values.prettyPrint);
                break;
        }
    }

    doResponse(res, type, status, _headers, content, pretty) {
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
        this.adapter.log.debug(`response: ${safeJsonStringify(res)}`);
        this.adapter.log.debug(`response content: ${safeJsonStringify(content)}`);
    }
}

module.exports = YandexSmarthomeProvider;