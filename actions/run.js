/* global process URL */

import path from 'path';
import fs from 'fs';
import fetch from 'isomorphic-unfetch';
import yaml from 'js-yaml';
import _sortBy from 'lodash/sortBy.js';
import _uniq from 'lodash/uniq.js';
import jsonschema from 'jsonschema';
import mkdirp from 'mkdirp';
import _mapValues from 'lodash/mapValues.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import glob from 'glob';
import dotenv from '../utils/dotenv.js';
import importer from './importer.js';
import { assert } from './utils.js';

const execP = promisify(exec);

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const apiHost = process.env.API_HOST;
const apiToken = process.env.API_TOKEN;
const contentHost = process.env.CONTENT_HOST;
const awsS3Target = process.env.AWS_S3_TARGET;

assert({ cwd, apiHost, contentHost });

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
    itemComment: async ({
        id,
        date_published: date,
        author,
        _meta: meta,
        content_text: yamlText,
    }) => {
        const { comment } = yaml.safeLoad(yamlText);
        const { name: sender } = author;
        const { target } = meta;
        if (comment) {
            const targetFile = path.join(cwd, new URL(target).pathname);
            if (fs.existsSync(targetFile)) {
                const item = yaml.safeLoad(fs.readFileSync(targetFile));
                if (item.allowComments !== false) {
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
        }
    },

    itemToCollection: async ({ author, _meta: meta, content_text: yamlText }) => {
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

    runUserMediaImport: async ({ author, _meta: meta }) => {
        await importer(author.name, meta.target);
    },
};

const run = async () => {
    console.log(apiHost);

    let quota = 1000;

    while (true) {
        const response = await fetch(new URL('/actions', apiHost).href);

        if (!response.ok) {
            throw Error('Fetch failed!', response.status);
        } else {
            console.log('HTTP OK.');

            const feed = await response.json();

            feed.feed_url = new URL(path.join('.', 'actions.json'), contentHost).href;

            validator.validate(feed, feedSchema, { throwError: true });

            if (feed.items.length === 0) {
                break;
            } else {
                const usernames = [];
                const items = _sortBy(feed.items, 'date_published');

                for (const item of items) {
                    if (quota === 0) {
                        throw Error('Quota exhausted!');
                    }

                    console.log('quota:', quota);
                    quota -= 1;

                    console.log('action:', item.title);

                    if (Object.keys(actions).includes(item.title)) {
                        console.log('id:', item.id);
                        console.log('author:', item.author.name);
                        console.log('recipient:', item._meta.recipient);
                        console.log('target:', item._meta.target);
                        console.log('data:', item.content_text.trim());

                        if (item._meta.recipient) usernames.push(item._meta.recipient);

                        await actions[item.title](item);

                        if (glob.sync(path.join('**', '*.jpg'), { cwd }).length !== 0) {
                            if (!awsS3Target) {
                                throw Error('No AWS_S3_TARGET!');
                            } else {
                                console.log('aws sync: ', awsS3Target);
                                const { stdout: awsOut } = await execP(
                                    `cd "${cwd}" && aws s3 sync --size-only --no-progress --exclude "*" --include "*.jpg" "./" "${awsS3Target}"`,
                                );
                                console.log(awsOut);
                            }
                        }

                        let gitChanges = false;

                        try {
                            const { stdout: gitOut } = await execP(
                                `cd "${cwd}" && git add . && git commit -m "${item.title} by ${item.author.name}"`,
                            );
                            console.log(gitOut);
                            gitChanges = true;
                        } catch (e) {
                            if (e.cmd) console.error(e.cmd);
                            if (e.stdout) console.error(e.stdout);
                            if (e.stderr) console.error(e.stderr);
                        }

                        if (gitChanges) {
                            await execP(`cd "${cwd}" && git push`);
                        } else {
                            console.log('Git: No changes.');
                        }
                    }

                    const deleteResponse = await fetch(item.url, {
                        method: 'DELETE',
                        headers: {
                            Authorization: `API_TOKEN ${apiToken}`,
                        },
                    });

                    console.log('DELETE', item.url, deleteResponse.status);

                    if (deleteResponse.status !== 200) {
                        throw Error('Failed to delete feed item.');
                    }

                    console.log('---');
                }
            }
        }
    }

    return 'Done.';
};

run().then(console.log).catch(console.error);
