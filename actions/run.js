/* global process URL */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import fetch from 'isomorphic-unfetch';
import yaml from 'js-yaml';
import _sortBy from 'lodash/sortBy.js';
import _last from 'lodash/last.js';
import _uniq from 'lodash/uniq.js';
import jsonschema from 'jsonschema';
import mkdirp from 'mkdirp';
import _mapValues from 'lodash/mapValues.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const apiHost = process.env.API_HOST;
const contentHost = process.env.CONTENT_HOST;

const validator = new jsonschema.Validator();
const feedSchema = JSON.parse(fs.readFileSync('./schemas/feed.json'));

const schemas = _mapValues(
    {
        profile: '',
        collection: '',
        species: '',
        item: '',
    },
    (v, k) => yaml.safeLoad(fs.readFileSync(path.join('.', 'schemas', `${v || k}.yaml`))),
);

const writeYaml = (filePath, obj, schema) => {
    console.log('-->', filePath);
    validator.validate(obj, schema, { throwError: true });
    fs.writeFileSync(
        filePath,
        yaml.safeDump(obj, {
            lineWidth: 1000,
            noRefs: true,
            sortKeys: false,
            skipInvalid: true,
        }),
    );
};

const actions = {
    itemComment: ({ id, date_published: date, author, _meta: meta, content_text: yamlText }) => {
        const { comment } = yaml.safeLoad(yamlText);
        const { name: sender } = author;
        const { target } = meta;
        if (comment) {
            const targetFile = path.join(cwd, new URL(target).pathname);
            if (fs.existsSync(targetFile)) {
                const item = yaml.safeLoad(fs.readFileSync(targetFile));
                item.comments = (item.comments || []).filter((i) => i.ref !== id);
                item.comments.push({
                    ref: id,
                    created_at: date,
                    username: sender,
                    text: comment,
                });
                // item.comments = _sortBy(item.comments, 'created_at');
                writeYaml(targetFile, item, schemas.item);
            }
        }
    },

    itemToCollection: ({ author, _meta: meta, content_text: yamlText }) => {
        const { collection: name } = yaml.safeLoad(yamlText);
        const { name: sender } = author;
        const { target } = meta;
        if (name) {
            const dirPath = path.join(cwd, sender, 'collections');
            mkdirp.sync(dirPath);
            const filePath = path.join(dirPath, `${name}.yaml`);
            const collection = fs.existsSync(filePath)
                ? yaml.safeLoad(fs.readFileSync(filePath))
                : {};
            const targetFile = new URL(target).pathname.replace(/^\//, '').replace(/\.yaml$/, '');
            collection.extra_items = _uniq([...(collection.extra_items || []), targetFile]).sort();
            writeYaml(filePath, collection, schemas.collection);
        }
    },
};

const run = async () => {
    console.log(apiHost);

    const lastUpdateFilePath = path.join(cwd, '.last_update');

    const lastUpdate = fs.existsSync(lastUpdateFilePath)
        ? JSON.parse(fs.readFileSync(lastUpdateFilePath))
        : '0';

    console.log('lastUpdate: ', lastUpdate);

    const response = await fetch(
        new URL(`/actions?after=${encodeURIComponent(lastUpdate)}`, apiHost).href,
    );

    if (response.ok) {
        console.log('ok');

        const feed = await response.json();

        feed.feed_url = new URL(path.join('.', 'actions.json'), contentHost).href;

        validator.validate(feed, feedSchema, { throwError: true });

        console.log('valid');

        if (feed.items.length === 0) {
            throw Error('No updates.');
        } else {
            const usernames = [];
            const items = _sortBy(feed.items, 'date_published');

            items.forEach((item) => {
                console.log('action:', item.title);

                if (Object.keys(actions).includes(item.title)) {
                    console.log('id:', item.id);
                    console.log('author:', item.author.name);
                    console.log('recipient:', item._meta.recipient);
                    console.log('target:', item._meta.target);
                    console.log('data:', item.content_text.trim());

                    if (item._meta.recipient) usernames.push(item._meta.recipient);

                    actions[item.title](item);

                    console.log('---');
                }
            });

            fs.writeFileSync(
                lastUpdateFilePath,
                JSON.stringify(_last(items).date_published),
                null,
                1,
            );

            if (usernames.length !== 0) {
                fs.writeFileSync(
                    path.join(cwd, '.updated_usernames'),
                    JSON.stringify(_uniq(usernames), null, 1),
                );
            }
        }
    }
};

run()
    .then(() => {
        console.log('Done.');
        process.exit(0);
    })
    .catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
