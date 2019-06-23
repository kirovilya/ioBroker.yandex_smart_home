/* jshint -W097 */
/* jshint strict:false */
/*jslint node: true */
/*jshint -W061 */
'use strict';

const {Types, ChannelDetector} = require('iobroker.type-detector');
const Converter = require('./converters');

const safeJsonStringify = require('./json');

const ignoreIds = [
    /^system\./,
    /^script\./,
];

class DeviceManager {
    constructor(adapter) {
        this.adapter = adapter;

        this.adapter.getForeignObject('system.config', (err, config) => {
            this.lang = config.common.language;
            this.systemConfig = config.common;
        });

        this.converter = new Converter(adapter);

        this.detector = new ChannelDetector();

        this.smartDevices = [];
    }

    _readObjects() {
        // читаем всё дерево устройств, каналов, состояний, перечислений iob
        return new Promise(resolve => {
            this.adapter.objects.getObjectView('system', 'state', {}, (err, _states) => {
                this.adapter.objects.getObjectView('system', 'channel', {}, (err, _channels) => {
                    this.adapter.objects.getObjectView('system', 'device', {}, (err, _devices) => {
                        this.adapter.objects.getObjectView('system', 'enum', {}, (err, _enums) => {
                            const objects = {};
                            const enums = {};
                            if (_devices && _devices.rows) {
                                for (let i = 0; i < _devices.rows.length; i++) {
                                    if (_devices.rows[i].value && _devices.rows[i].value._id && !ignoreIds.find(reg => reg.test(_devices.rows[i].value._id))) {
                                        objects[_devices.rows[i].value._id] = _devices.rows[i].value;
                                    }
                                }
                            }
                            if (_channels && _channels.rows) {
                                for (let i = 0; i < _channels.rows.length; i++) {
                                    if (_channels.rows[i].value && _channels.rows[i].value._id && !ignoreIds.find(reg => reg.test(_channels.rows[i].value._id))) {
                                        objects[_channels.rows[i].value._id] = _channels.rows[i].value;
                                    }
                                }
                            }
                            if (_states && _states.rows) {
                                for (let i = 0; i < _states.rows.length; i++) {
                                    if (_states.rows[i].value && _states.rows[i].value._id && !ignoreIds.find(reg => reg.test(_states.rows[i].value._id))) {
                                        objects[_states.rows[i].value._id] = _states.rows[i].value;
                                    }
                                }
                            }
                            if (_enums && _enums.rows) {
                                for (let i = 0; i < _enums.rows.length; i++) {
                                    if (_enums.rows[i].value && _enums.rows[i].value._id) {
                                        enums[_enums.rows[i].value._id] = _enums.rows[i].value;
                                        objects[_enums.rows[i].value._id] = _enums.rows[i].value;
                                    }
                                }
                            }
                            resolve({objects, enums});
                        });
                    });
                });
            });
        });
    }

    _getSmartName(states, id) {
        // получение наименования
        if (!id) {
            if (!this.adapter.config.noCommon) {
                return states.common.smartName;
            } else {
                return (states &&
                    states.common &&
                    states.common.custom &&
                    states.common.custom[this.adapter.namespace]) ?
                    states.common.custom[this.adapter.namespace].smartName : undefined;
            }
        } else
        if (!this.adapter.config.noCommon) {
            return states[id] && states[id].common ? states[id].common.smartName : null;
        } else {
            return (states[id] &&
                states[id].common &&
                states[id].common.custom &&
                states[id].common.custom[this.adapter.namespace]) ?
                states[id].common.custom[this.adapter.namespace].smartName || null : null;
        }
    }

    _processIobState(ids, objects, id, roomName, funcName, result) {
        if (!id) {
            return;
        }

        let friendlyName = this._getSmartName(objects, id);
        if (typeof friendlyName === 'object' && friendlyName) {
            friendlyName = friendlyName[this.lang] || friendlyName.en;
        }

        if (friendlyName === 'ignore' || friendlyName === false) {
            return;
        }

        if (!friendlyName && !roomName && !funcName) {
            return;
        }

        try {
            // try to detect device
            const options = {
                objects:            objects,
                id:                 id,
                _keysOptional:      ids,
                _usedIdsOptional:   this.usedIds
            };
            const controls = this.detector.detect(options);
            if (controls) {
                controls.forEach(control => {
                    if (this.converter.types[control.type]) {
                        const entities = this.converter.types[control.type](id, control, friendlyName, roomName, funcName, objects[id], objects);
                        // converter could return one ore more devices as array
                        if (entities && entities.length) {
                            // iterate through entities
                            entities.forEach(entity => {
                                if (!entity) return;

                                const _entity = result.find(e => e.entity_id === entity.entity_id);
                                if (_entity) {
                                    console.log('Duplicates found for ' + entity.entity_id);
                                    return;
                                }

                                result.push(entity);
                                this.adapter.log.debug('[Type-Detector] Created auto device: ' + entity.entity_id + ' - ' + control.type + ' - ' + id);
                            });
                        }
                    } else {
                        this.adapter.log.debug('[Type-Detector] device ' + control.states.find(e => e.id).id + ' - ' + control.type + ' - ' + id + ' is not yet supported');
                    }
                });
            } else {
                console.log(`[Type-Detector] Nothing found for ${options.id}`);
            }
        } catch (e) {
            this.adapter.log.error('[Type-Detector] Cannot process "' + id + '": ' + e);
        }
    }

    _updateDevices() {
        // обновление списка устройств (всех возможных устройств, полученных из состояний)
        return this._readObjects()
            .then(data => {
                const {objects, enums} = data;
                const ids    = Object.keys(objects);

                this.enums   = [];
                this.enums   = [];
                this.usedIds = [];
                this.keys    = [];

                ids.sort();

                // Build overlap from rooms and functions
                const rooms = [];
                const funcs = [];
                // let smartName;
                Object.keys(enums).forEach(id => {
                    // smartName = this._getSmartName(enums[id]);
                    if (id.match(/^enum\.rooms\./)/*     && smartName !== 'ignore' && smartName !== false*/) {
                        rooms.push(id);
                    } else
                    if (id.match(/^enum\.functions\./)/* && smartName !== 'ignore' && smartName !== false*/) {
                        funcs.push(id);
                    }
                });

                const result = [];
                const roomNames = {};
                funcs.forEach(funcId => {
                    const func = enums[funcId];
                    if (!func.common || !func.common.members || typeof func.common.members !== 'object' || !func.common.members.length) return;

                    // Get the name of function (with language and if name is empty)
                    let funcName = this._getSmartName(func);
                    funcName = funcName || func.common.name;

                    if (funcName && typeof funcName === 'object') funcName = funcName[this.lang] || funcName.en;

                    if (!funcName) {
                        funcName = funcId.substring('enum.functions.'.length);
                        funcName = funcName[0].toUpperCase() + funcName.substring(1);
                    }

                    func.common.members.forEach(id => {
                        rooms.forEach(roomId => {
                            const room = enums[roomId];
                            if (!room.common || !room.common.members || typeof func.common.members !== 'object' || !room.common.members.length) return;

                            // If state or channel is in some room and in some function
                            const pos = room.common.members.indexOf(id);
                            if (pos !== -1) {
                                // find name for room if not found earlier
                                if (!roomNames[roomId]) {
                                    // Get the name of function (with language and if name is empty)
                                    let roomName = this._getSmartName(room);
                                    roomName = roomName || room.common.name;
                                    if (roomName && typeof roomName === 'object') roomName = roomName[this.lang] || roomName.en;
                                    if (!roomName) {
                                        roomName = roomId.substring('enum.rooms.'.length);
                                        roomName = roomName[0].toUpperCase() + roomName.substring(1);
                                    }
                                    roomNames[roomId] = roomName;
                                }

                                this._processIobState(ids, objects, id, roomNames[roomId], funcName, result);
                            }
                        });
                    });
                });

                this.usedIds = null;
                this.keys    = null;

                result.forEach(entity => this.adapter.log.debug(`AUTO Device detected: ${entity.context.id} => ${entity.context.type} ${entity.context.name}`));

                return result;
            });
    }

    getAll() {
        return this._updateDevices().then(smartDevices => {
            this.smartDevices = smartDevices;
            this.adapter.log.debug(`SmartDevices: ${safeJsonStringify(smartDevices)}`);
        });
    }
    
    _getSmartDeviceData(entity) {
        return new Promise(resolve => {
            if (entity.context) {
                if (entity.COMMANDS && entity.COMMANDS.get_state) {
                    entity.COMMANDS.get_state(entity).then(() => {
                        resolve(entity.context);
                    });
                } else {
                    resolve(entity.context);
                }
            } else {
                resolve();
            }
        });
    }

    getSmartDevices() {
        return this.getAll().then(() => {
            const result = [];
            this.smartDevices.forEach(entity => {
                result.push(
                    this._getSmartDeviceData(entity)
                );
            });
            return Promise.all(result);
        });
    }

    querySmartDevicesByIds(ids) {
        return new Promise(resolve => {
            const result = [];
            this.smartDevices.filter(
                entity => ids.includes(entity.context.id)
            ).forEach(entity => {
                result.push(
                    this._getSmartDeviceData(entity)
                );
            });
            resolve(Promise.all(result));
        });
    }

    _doSmartDeviceAction(entity, data) {
        return new Promise(resolve => {
            if (entity.COMMANDS && entity.COMMANDS.set_state) {
                entity.COMMANDS.set_state(entity, data).then((res) => resolve(res));
            } else {
                resolve(data);
            }
        });
    }

    doAction(deviceData) {
        return new Promise(resolve => {
            const entity = this.smartDevices.find(entity => deviceData.id === entity.context.id);
            if (entity) {
                resolve(this._doSmartDeviceAction(entity, deviceData));
            };
            resolve();
        });
    }
}

module.exports = DeviceManager;