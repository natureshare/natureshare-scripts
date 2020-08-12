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
    obj && obj.latitude && obj.longitude && obj.latitude !== '0' && obj.longitude !== '0';

export const coordValue = (v) => Math.round(parseFloat(v) * 1000000) / 1000000;

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
