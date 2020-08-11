/* global process */

import fs from 'fs';
import yaml from 'js-yaml';
import glob from 'glob';
import path from 'path';
import jsonschema from 'jsonschema';
import dotenv from 'dotenv';
import _mapValues from 'lodash/mapValues.js';

dotenv.config();

const contentPath = process.env.CONTENT_FILE_PATH;
const speciesPath = process.env.SPECIES_FILE_PATH;

const validator = new jsonschema.Validator();

const schemas = _mapValues(
    {
        profile: '',
        collection: '',
        species: '',
        item: '',
    },
    (v, k) => yaml.safeLoad(fs.readFileSync(path.join('.', 'schemas', `${v || k}.yaml`))),
);

let fail = false;

const validate = (cwd, f, schema) => {
    const result = validator.validate(yaml.safeLoad(fs.readFileSync(path.join(cwd, f))), schema, {
        throwError: false,
    });
    if (result.errors && result.errors.length !== 0) {
        console.log('-->', f);
        result.errors.forEach((e) =>
            console.log('   ', '-->', e.stack.replace(/^instance\s+/, '')),
        );
        console.log('');
        fail = true;
    }
};

[
    [contentPath, ['*', 'profile.yaml'], schemas.profile],
    [contentPath, ['*', 'collections', '*.yaml'], schemas.collection],
    [contentPath, ['*', 'items', '*', '*', '*.yaml'], schemas.item],
    [speciesPath, ['*', '*', '*.yaml'], schemas.species],
]
    .filter((i) => Boolean(i[0]))
    .forEach(([cwd, files, schema]) => {
        console.log(path.join(cwd, ...files));
        glob.sync(path.join(...files), { cwd }).forEach((f) => {
            validate(cwd, f, schema);
        });
    });

if (fail) throw new Error('Failed validation!');
