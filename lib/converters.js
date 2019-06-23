/* jshint -W097 */
/* jshint strict:false */
/*jslint node: true */
/*jshint -W061 */
'use strict';

const {Types} = require('iobroker.type-detector');

function replaceInvalidChars(name) {
    name = name.replace(/[^a-zA-Z0-9А-Яа-я_]/g, '_');
    name = name.replace(/Ü/g, 'UE');
    name = name.replace(/Ä/g, 'AE');
    name = name.replace(/Ö/g, 'OE');
    name = name.replace(/ü/g, 'ue');
    name = name.replace(/ä/g, 'ae');
    name = name.replace(/ö/g, 'oe');
    name = name.replace(/ß/g, 'ss');
    return name;
}

class Converter {
    constructor(adapter) {
        this.adapter = adapter;
        
        this.adapter.getForeignObject('system.config', (err, config) => {
            this.lang = config.common.language;
            this.systemConfig = config.common;
        });

        this.types = {
            [Types.socket]: this._processSocket.bind(this),
            [Types.light]: this._processLight.bind(this),
            [Types.dimmer]: this._processDimmer.bind(this),
            [Types.ct]: this._processCT.bind(this),
            [Types.rgbSingle]: this._processRGB.bind(this),
            // [Types.motion]: this._processMotion.bind(this),
            // [Types.window]: this._processWindow.bind(this),
            // [Types.door]: this._processDoor.bind(this),
            // [Types.button]: this._processSocket.bind(this),
            // [Types.temperature]: this._processTemperature.bind(this),
            // [Types.lock]: this._processLock.bind(this),
            // [Types.thermostat]: this._processThermostat.bind(this),
            // [Types.blind]: this._processBlind.bind(this),
            // [Types.weatherForecast]: this._processWeather.bind(this),
            // [Types.location]: this._processLocation.bind(this),
            // [Types.media]: this._processMediaPlayer.bind(this),
            // [Types.image]: this._processImage.bind(this),
        };
        this._entities = [];
        this._entity2ID = {};
        this._ID2entity = {};
    }

    _getObjectName(obj, _lang) {
        _lang = _lang || this.lang;

        if (obj.common && obj.common.name) {
            if (typeof obj.common.name === 'object') {
                if (obj.common.name[_lang] || obj.common.name.en) {
                    return obj.common.name[_lang] || obj.common.name.en;
                } else {
                    const lang = Object.keys(obj.common.name).find(lang => obj.common.name[lang]);
                    if (obj.common.name[lang]) {
                        return obj.common.name[lang];
                    } else {
                        return obj._id;
                    }
                }
            } else {
                return obj.common.name;
            }
        } else {
            return obj._id;
        }
    }

    _generateName(obj, lang) {
        return this._getObjectName(obj, lang).replace(/[^-._\w0-9А-Яа-яÄÜÖßäöü]/g, '_');
    }
    
    _processCommon(id, name, room, func, obj, entityType, entity_id) {
        if (!name) {
            if (func && room) {
                name = room + ' ' + func;
            } else {
                name = obj.common.custom[this.adapter.namespace].name || this._generateName(obj);
            }
        }
        const _name = replaceInvalidChars(this._generateName(obj, 'en'));

        const entity = {
            entity_id: entity_id || (entityType + '.' + _name),
            //state: this._iobState2EntityState(obj._id, state.val);
            attributes: {
                friendly_name: name
            },

            // объект описания smart-устройства
            context: {
                id: obj._id,
                type: entityType,
                name: name,
                description: name,
                room: room,
                custom_data: {
                    entity_id: entity_id || (entityType + '.' + _name),
                },
                capabilities: [],
                device_info: {
                    "manufacturer": "IOBroker",
                    "model": entity_id || (entityType + '.' + _name),
                    "hw_version": "",
                    "sw_version": ""
                }
            },

            // доступные команды для управления
            COMMANDS: {

            },
        };

        if (obj.common.unit) {
            entity.attributes.unit_of_measurement = obj.common.unit;
            //entity.attributes.unit_of_measurement_dict = obj.common.unit;
        }

        this._ID2entity[obj._id] = this._ID2entity[obj._id] || [];
        this._ID2entity[obj._id].push(entity);
        this._entity2ID[entity.entity_id] = entity;
        this._entities.push(entity);
        return entity;
    }

    _addID2entity(id, entity) {
        this._ID2entity[id] = this._ID2entity[id] || [];
        const found = this._ID2entity[id].find(e => e.entity_id === entity.entity_id);
        if (!found) {
            this._ID2entity[id].push(entity);
        }
    }

    // ------------------------------- START OF CONVERTERS ---------------------------------------- //

    _processSocket(id, control, name, room, func, _obj) {
        const entity = this._processCommon(id, name, room, func, _obj, 'devices.types.switch');

        let state = control.states.find(s => s.id && s.name === 'SET');
        entity.STATE = {setId: null, getId: null};
        if (state && state.id) {
            entity.STATE.setId = state.id;
            entity.STATE.getId = state.id;
            entity.attributes.icon = 'mdi:power-socket-eu';
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        // capabilities
        entity.context.capabilities.push({
            type: "devices.capabilities.on_off",
        });
        entity.COMMANDS.get_state = this._get_state_on_off.bind(this);
        entity.COMMANDS.set_state = this._set_state_on_off.bind(this);
        return [entity];
    }

    _get_state_on_off(entity) {
        return new Promise(resolve => {
            const stateId = entity.STATE.getId;
            const capability = entity.context.capabilities.find(cap => cap.type === "devices.capabilities.on_off");
            if (capability && stateId) {
                this.adapter.getForeignState(stateId, (err, state) => {
                    if (!err) {
                        capability.state = {
                            instance: "on",
                            value: state.val,
                        };
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    _set_state_on_off(entity, data) {
        return new Promise(resolve => {
            const stateId = entity.STATE.setId;
            const capability = data.capabilities.find(cap => cap.type === "devices.capabilities.on_off");
            if (capability && capability.state && stateId) {
                this.adapter.setForeignState(stateId, capability.state.value);
                capability.state.action_result = 'DONE';
            }
            resolve(data);
        });
    }

    _get_state_brightness(entity) {
        return new Promise(resolve => {
            const dimmer = entity.ATTRIBUTES.find(attr => attr.attribute === 'brightness');
            const stateId = dimmer ? dimmer.getId : undefined;
            const capability = entity.context.capabilities.find(cap => cap.type === "devices.capabilities.range");            
            if (capability && stateId) {
                this.adapter.getForeignState(stateId, (err, state) => {
                    if (!err) {
                        capability.state = {
                            instance: "brightness",
                            value: state.val,
                        };
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    _set_state_brightness(entity, data) {
        return new Promise(resolve => {
            const dimmer = entity.ATTRIBUTES.find(attr => attr.attribute === 'brightness');
            const stateId = dimmer ? dimmer.getId : undefined;
            const capability = data.capabilities.find(cap => cap.type === "devices.capabilities.range");            
            if (capability && capability.state && stateId) {
                this.adapter.setForeignState(stateId, capability.state.value);
                capability.state.action_result = 'DONE';
            }
            resolve(data);
        });
    }

    _processLight(id, control, name, room, func, _obj) {
        const entity = this._processCommon(id, name, room, func, _obj, 'devices.types.light');

        let state = control.states.find(s => s.id && s.name === 'SET');
        entity.STATE = {setId: null, getId: null};
        if (state && state.id) {
            entity.STATE.setId = state.id;
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        // capabilities
        entity.context.capabilities.push({
            type: "devices.capabilities.on_off",
        });
        entity.COMMANDS.get_state = this._get_state_on_off.bind(this);
        entity.COMMANDS.set_state = this._set_state_on_off.bind(this);
        return [entity];
    }

    _processBlind(id, control, name, room, func, _obj, objects) {
        const entity = this._processCommon(id, name, room, func, _obj, 'input_number');

        let state = control.states.find(s => s.id && s.name === 'SET');
        entity.STATE = {setId: null, getId: null};
        entity.attributes.icon = 'mdi:window-maximize';
        if (state && state.id) {
            entity.STATE.setId = state.id;
            entity.STATE.getId = state.id;
            entity.attributes.mode = 'slider';
            entity.attributes.min = objects[state.id].common.min !== undefined ? objects[state.id].common.min : 0;
            entity.attributes.max = objects[state.id].common.max !== undefined ? objects[state.id].common.max : 100;
            entity.attributes.step = objects[state.id].common.step || 1;
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        return [entity];
    }

    _parseCommandDimmer(entity, command, data, user) {
        return new Promise((resolve, reject) => {
            // if ON/OFF object exists
            if (entity.STATE.setId && entity.STATE.getId) {
                // read actual state
                this.adapter.getForeignState(entity.STATE.getId, {user}, (err, state) => {
                    // if lamp is not ON
                    if (!state || !state.val) {
                        // ON
                        this.adapter.setForeignState(entity.STATE.setId, true, false, {user}, () => {
                            // If dimmer level set
                            if (data.data_servivce.brightness_pct !== undefined) {
                                this.adapter.setForeignState(command.setId, data.data_servivce.brightness_pct, false, {user}, err =>
                                    err ? reject(err) : resolve());
                            } else {
                                resolve();
                            }
                        });
                    } else
                    // If dimmer level set
                    if (data.data_servivce.brightness_pct !== undefined) {
                        this.adapter.setForeignState(command.setId, data.data_servivce.brightness_pct, false, {user}, err =>
                            err ? reject(err) : resolve());
                    } else {
                        resolve();
                    }
                });
            } else
            // If dimmer level set
            if (data.data_servivce.brightness_pct !== undefined) {
                this.adapter.setForeignState(command.setId, data.data_servivce.brightness_pct, false, {user}, err =>
                    err ? reject(err) : resolve());
            } else {
                resolve();
            }
        });
    }

    _processDimmer(id, control, name, room, func, _obj) {
        const entity = this._processCommon(id, name, room, func, _obj, 'devices.types.light');

        let state = control.states.find(s => s.id && ['ON_SET', 'ON'].includes(s.name));
        entity.STATE = {setId: null, getId: null};
        if (state && state.id) {
            entity.STATE.setId = state.id;
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'ON_ACTUAL');
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        let getDimmer;
        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            getDimmer = state.id;
        }

        state = control.states.find(s => s.id && ['DIMMER', 'SET'].includes(s.name));
        if (state && state.id) {
            getDimmer = getDimmer || state.id;
            entity.ATTRIBUTES = [{attribute: 'brightness', getId: getDimmer}];
            entity.COMMANDS = [{
                service: 'turn_on',
                setId: state.id,
                parseCommand: this._parseCommandDimmer.bind(this)
            }];
            this._addID2entity(state.id, entity);
        } else if (getDimmer) {
            entity.ATTRIBUTES = [{attribute: 'brightness', getId: getDimmer}];
            this._addID2entity(state.id, entity);
        }

        // capabilities
        entity.context.capabilities.push({
            type: "devices.capabilities.on_off",
        });
        entity.context.capabilities.push({
            type: "devices.capabilities.range",
            parameters: {
                instance: "brightness",
                unit: "unit.percent",
                range: {min: 0, max: 100},
            },
        });
        entity.COMMANDS.get_state = (entity) => {
            return this._get_state_on_off(entity).then(() =>
                this._get_state_brightness(entity)
            );
        };
        entity.COMMANDS.set_state = (entity, data) => {
            return this._set_state_on_off(entity, data).then((res) =>
                this._set_state_brightness(entity, res)
            );
        };

        return [entity];
    }

    _processCT(id, control, name, room, func, _obj) {
        const entity = this._processDimmer(id, control, name, room, func, _obj)[0];

        // capabilities
        entity.context.capabilities.push({
            type: "devices.capabilities.color_setting",
            parameters: {
                temperature_k: {min: 0, max: 400},
            },
        });
        return [entity];
    }

    _processRGB(id, control, name, room, func, _obj) {
        const entity = this._processDimmer(id, control, name, room, func, _obj)[0];
        
        // capabilities
        entity.context.capabilities.push({
            type: "devices.capabilities.color_setting",
            parameters: {
                color_model: "rgb",
            },
        });

        return [entity];
    }

    _processDoor(id, control, name, room, func, _obj, objects) {
        const entity = this._processCommon(id, name, room, func, _obj, 'binary_sensor');

        const state = control.states.find(s => s.id && s.name === 'ACTUAL');
        entity.STATE = {getId: null};
        entity.attributes.icon = 'mdi:door';
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        return [entity, this._processBattery(control, name, room, func, objects)];
    }

    _processWindow(id, control, name, room, func, _obj, objects) {
        const entity = this._processCommon(id, name, room, func, _obj, 'binary_sensor');

        const state = control.states.find(s => s.id && s.name === 'ACTUAL');
        entity.STATE = {getId: null};
        entity.attributes.icon = 'mdi:window-maximize';
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        return [entity, this._processBattery(control, name, room, func, objects)];
    }

    _processBattery(control, name, room, func, objects) {
        const state = control.states.find(s => s.id && s.name === 'LOWBAT');
        if (state && state.id) {
            const entity = this._processCommon(state.id, name, room, func, objects[state.id], 'sensor');
            entity.STATE = {getId: state.id};
            entity.iobType = 'LOWBAT';
            entity.attributes.icon = 'mdi:battery-alert';
            this._addID2entity(state.id, entity);
            return entity;
        } else {
            return null;
        }
    }

    _processMotion(id, control, name, room, func, _obj, objects) {
        const entity = this._processCommon(id, name, room, func, _obj, 'binary_sensor');

        const state = control.states.find(s => s.id && s.name === 'ACTUAL');
        entity.STATE = {getId: null};
        entity.attributes.icon = 'mdi:motion-sensor';
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        return [entity, this._processBattery(control, name, room, func, objects)];
    }

    _processLock(id, control, name, room, func, _obj, objects) {
        const entity = this._processCommon(id, name, room, func, _obj, 'lock');

        let state = control.states.find(s => s.id && s.name === 'SET');
        entity.STATE = {setId: null, getId: null};
        entity.attributes.icon = 'mdi:lock-open';
        if (state && state.id) {
            entity.STATE.setId = state.id;
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }
        return [entity, this._processBattery(control, name, room, func, objects)];
    }

    _processTemperature(id, control, name, room, func, _obj, objects) {
        let entity;
        let state = control.states.find(s => s.id && s.name === 'ACTUAL'); // temperature
        if (state && state.id) {
            entity = this._processCommon(state.id, name, room, func, objects[state.id], 'sensor');
            entity.STATE = {getId: state.id};
            this._addID2entity(state.id, entity);
        }

        state = control.states.find(s => s.id && s.name === 'SECOND'); // humidity
        let entityHum;
        if (state && state.id) {
            entityHum = this._processCommon(state.id, name, room, func, objects[state.id], 'sensor');
            entityHum.STATE = {getId: state.id};
            entityHum.attributes.icon = 'mdi:mdi-water';
            entityHum.attributes.unit_of_measurement = entityHum.attributes.unit_of_measurement || objects[state.id].common.unit || '%';
            this._addID2entity(state.id, entityHum);
        }

        return [entity, entityHum, this._processBattery(control, name, room, func, objects)];
    }

    _processThermostat(id, control, name, room, func, _obj, objects) {
        // - climate => STATE on/off, attributes: [current_temperature, operation_mode, operation_list, target_temp_step, target_temp_low, target_temp_high, min_temp, max_temp, temperature], commands:
        const entity = this._processCommon(id, name, room, func, _obj, 'climate');

        let state = control.states.find(s => s.id && s.name === 'POWER');
        entity.STATE = {setId: null, getId: null};
        entity.attributes.icon = 'mdi:thermostat';

        if (state && state.id) {
            entity.STATE.setId = state.id;
            entity.STATE.getId = state.id;
            this._addID2entity(state.id, entity);
        }

        // actual temperature
        state = control.states.find(s => s.id && s.name === 'ACTUAL');
        if (state && state.id) {
            entity.ATTRIBUTES = entity.ATTRIBUTES || [];
            entity.ATTRIBUTES.push({attribute: 'current_temperature', getId: state.id});
            this._addID2entity(state.id, entity);
            if (objects[state.id].common && objects[state.id].common.unit) {
                entity.attributes.unit_of_measurement = objects[state.id].common.unit;
            }
        }

        state = control.states.find(s => s.id && s.name === 'SET');
        if (state && state.id) {
            entity.ATTRIBUTES = entity.ATTRIBUTES || [];
            entity.ATTRIBUTES.push({attribute: 'temperature', getId: state.id});
            entity.COMMANDS = [{
                service: 'set_temperature',
                setId: state.id,
                parseCommand: (entity, command, data, user) =>
                    new Promise((resolve, reject) =>
                        this.adapter.setForeignState(command.setId, data.service_data.temperature, false, {user}, err =>
                            err ? reject(err) : resolve()))
            }];

            this._addID2entity(state.id, entity);

            if (objects[state.id].common) {
                if (!entity.attributes.unit_of_measurement && objects[state.id].common.unit) {
                    entity.attributes.unit_of_measurement = objects[state.id].common.unit;
                }
                if (objects[state.id].common.min) {
                    entity.attributes.min_temp = objects[state.id].common.min;
                }
                if (objects[state.id].common.min) {
                    entity.attributes.max_temp = objects[state.id].common.max;
                }
                if (objects[state.id].common.step) {
                    entity.attributes.target_temp_step = objects[state.id].common.step;
                }
            }
        }

        // detect second entity => humidity
        let entryHum;
        state = control.states.find(s => s.id && s.name === 'HUMIDITY');
        if (state && state.id) {
            entryHum = this._processCommon(state.id, name, room, func, objects[state.id], 'sensor');
            entryHum.STATE = {getId: state.id};
            entryHum.attributes.icon = 'mdi:mdi-water';
            entryHum.attributes.unit_of_measurement = entryHum.attributes.unit_of_measurement || objects[state.id].common.unit || '%';
            this._addID2entity(state.id, entryHum);
        }
        return [entity, entryHum, this._processBattery(control, name, room, func, objects)];
    }
}

module.exports = Converter;