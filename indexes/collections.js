/* global process URL */

import path from 'path';
import glob from 'glob';
import fs from 'fs';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import _startCase from 'lodash/startCase.js';
import _uniq from 'lodash/uniq.js';
import _uniqBy from 'lodash/uniqBy.js';
import _pickBy from 'lodash/pickBy.js';
import _mapValues from 'lodash/mapValues.js';
import _startsWith from 'lodash/startsWith.js';
import omitNull from './utils/omitNull.js';
import { writeFiles, writeFilesIndex } from './utils/writeFiles.js';
import loadItem from './utils/loadItem.js';
import { userUrl, dirStr, sortFeedItems, coord } from './utils/utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const appHost = process.env.APP_HOST;
const contentHost = process.env.CONTENT_HOST;

const debug = false;

function consoleLog(...str) {
    if (debug) console.log(...str);
}

const build = (userDir) => {
    console.log(userDir);

    const collectionsDir = path.join(cwd, userDir, 'collections');
    const collectionsIndexDir = path.join(cwd, userDir, '_index', 'collections');

    const collectionsIndex = {};

    // Load collection meta-data:

    if (fs.existsSync(collectionsDir)) {
        consoleLog('  ', 'YAML');

        glob.sync(path.join('*.yaml'), { cwd: collectionsDir }).forEach((f) => {
            const name = f.replace(/\.yaml$/, '');
            consoleLog('    ', name);

            const meta = yaml.safeLoad(fs.readFileSync(path.join(collectionsDir, f)));

            collectionsIndex[name] = {
                title: meta.title || _startCase(name),
                description: (meta.description || '').slice(0, 1000),
                latitude: meta.latitude,
                longitude: meta.longitude,
                featured: meta.featured,
                extraItems: _uniq(meta.extra_items || []),
                members: _uniq([userDir, ...(meta.admins || []), ...(meta.members || [])]),
                items: [],
            };
        });
    }

    // Load collection indexes:

    if (fs.existsSync(collectionsIndexDir)) {
        consoleLog('  ', 'JSON');

        glob.sync(path.join('*', 'index.json'), {
            cwd: collectionsIndexDir,
        }).forEach((f) => {
            const name = path.dirname(f);

            if (collectionsIndex[name] === undefined) {
                consoleLog('    ', name);

                collectionsIndex[name] = {
                    title: _startCase(name),
                    extraItems: [],
                    members: [userDir],
                    items: [],
                };
            }
        });
    }

    // Aggregate collection items, one file for each collection:

    consoleLog('  ', 'LOAD');

    Object.keys(collectionsIndex).forEach((c) => {
        consoleLog('    ', c);

        // Load in extra items manually added to the YAML file:

        collectionsIndex[c].extraItems.forEach((e) => {
            const [u, , ...f] = e.split(path.sep);

            consoleLog('      ', 'Extra:', e);

            const { item } = loadItem(u, `${path.join(...f)}.yaml`);

            item.author = {
                name: u,
                url: userUrl(u),
            };

            collectionsIndex[c].items.push(item);
        });

        // Load in item indexes for each member:

        collectionsIndex[c].members.forEach((m) => {
            let page = 1;
            let pageCount = 1;
            do {
                const f = path.join(
                    cwd,
                    m,
                    '_index',
                    'collections',
                    c,
                    `index${page === 1 ? '' : `_${page}`}.json`,
                );
                if (fs.existsSync(f)) {
                    consoleLog('      ', 'Import:', f);
                    const feed = JSON.parse(fs.readFileSync(f));
                    collectionsIndex[c].items = collectionsIndex[c].items.concat(feed.items);
                    pageCount = feed.pageCount;
                    page += 1;
                } else {
                    page = pageCount + 1;
                }
            } while (page <= pageCount);
        });

        if (collectionsIndex[c].items.length !== 0) {
            collectionsIndex[c].items = sortFeedItems(_uniqBy(collectionsIndex[c].items, 'id'));

            // Aggregate index:

            writeFiles({
                userDir,
                subDir: path.join('collections', dirStr(c), 'aggregate'),
                feedItems: collectionsIndex[c].items,
                _title: collectionsIndex[c].title,
                _description: collectionsIndex[c].description,
            });
        }
    });

    // Index of all collections (this must be AFTER aggregation for accurate counts):

    writeFilesIndex({
        index: _pickBy(_mapValues(collectionsIndex, 'items'), (i) => i.length !== 0),
        userDir,
        subDir: 'collections',
        _title: 'Collections',
        metaCb: (c) => {
            const collection = collectionsIndex[c];

            const filePath = path.join(
                userDir,
                '_index',
                'collections',
                dirStr(c),
                'aggregate',
                'index.json',
            );

            const id = new URL(path.join('.', filePath), contentHost).href;

            const uniqTags = collection.items.reduce(
                (acc, i) => _uniq([...acc, ...(i.tags || [])]),
                [],
            );

            return omitNull({
                id,
                url: `${appHost}items?i=${encodeURIComponent(id)}`,
                title: collection.title,
                _geo: omitNull({
                    coordinates: coord([collection.longitude, collection.latitude]),
                }),
                _meta: omitNull({
                    featured: collection.featured || null,
                    idCount: uniqTags.filter((t) => _startsWith(t, 'id=')).length,
                    tagCount: uniqTags.filter((t) => _startsWith(t, 'tag=')).length,
                }),
            });
        },
    });
};

if (process.argv.length === 3) {
    build(process.argv[2]);
} else {
    glob.sync('*', { cwd })
        .filter(
            (f) =>
                f !== '_index' && f !== '_scripts' && fs.lstatSync(path.join(cwd, f)).isDirectory(),
        )
        .slice(0, 100000)
        .forEach(build);
}
