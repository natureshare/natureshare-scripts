import _isArray from 'lodash/isArray.js';
import _omitBy from 'lodash/omitBy.js';
import jsonschema from 'jsonschema';
import yaml from 'js-yaml';
import fs from 'fs';

export const _clean = (obj) =>
    _omitBy(
        obj,
        (i) => i === undefined || i === null || i === '' || (_isArray(i) && i.length === 0),
    );

export const locationIsValid = (obj) =>
    obj &&
    parseFloat(obj.latitude) &&
    parseFloat(obj.longitude) &&
    parseFloat(obj.latitude) !== 0 &&
    parseFloat(obj.longitude) !== 0;

export const coordValue = (v) => Math.round(parseFloat(v) * 1000000) / 1000000;

export const getValidLocation = (obj) => {
    if (obj && typeof obj === 'object') {
        if (locationIsValid(obj)) {
            return {
                latitude: coordValue(obj.latitude),
                longitude: coordValue(obj.longitude),
            };
        }
    }
    return {};
};

const validator = new jsonschema.Validator();
const itemSchema = yaml.safeLoad(fs.readFileSync('./schemas/item.yaml'));

export const validateItem = (obj, throwError) =>
    validator.validate(obj, itemSchema, {
        throwError,
    });

export const parseItemDescription = (str) => {
    if (str && str.length !== 0 && str.substr('--- #natureshare.org') !== -1) {
        const doc = str.split('---', 3)[1];
        if (doc && doc.length > 0) {
            const item = _clean(yaml.safeLoad(doc));
            const result = validateItem(item, false);
            if (result.errors.length === 0) {
                return item;
            }
            // console.log(result.errors);
        }
    }
    return null;
};

export const slugify = (str) =>
    str
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9-_.~]+/g, '')
        .replace(/_+/g, '_')
        .replace(/^_/, '')
        .replace(/_$/, '');
