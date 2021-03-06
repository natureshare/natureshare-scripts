/* global process URL */

import path from 'path';
import glob from 'glob';
import fs from 'fs';
import yaml from 'js-yaml';
import _ from 'lodash';
import _stripTags from 'underscore.string/stripTags.js';
import MarkdownIt from 'markdown-it';
import dotenv from '../utils/dotenv.js';
import omitNull from './utils/omitNull.js';
import { writeFiles, writeFilesIndex } from './utils/writeFiles.js';
import loadItem from './utils/loadItem.js';
import { userUrl, dirStr, sortFeedItems, coord } from './utils/utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const appHost = process.env.APP_HOST;
const contentHost = process.env.CONTENT_HOST;

const debug = false;

const markdown = new MarkdownIt({ html: false, breaks: false, linkify: true });

function consoleLog(...str) {
    if (debug) console.log(...str);
}

const build = (userDir) => {
    console.log(userDir);

    const collectionsDir = path.join(cwd, userDir, 'collections');
    const collectionsIndexDir = path.join(cwd, userDir, 'collections');

    const collectionsIndex = {};

    // Load collection meta-data:

    if (fs.existsSync(collectionsDir)) {
        consoleLog('  ', 'YAML');

        glob.sync(path.join('*.yaml'), { cwd: collectionsDir }).forEach((f) => {
            const name = f.replace(/\.yaml$/, '');
            consoleLog('    ', name);

            const meta = yaml.safeLoad(fs.readFileSync(path.join(collectionsDir, f)));

            collectionsIndex[name] = {
                title: _.upperFirst(name.replace(/_/g, ' ')),
                ...meta,
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
                    title: _.upperFirst(name.replace(/_/g, ' ')),
                    items: [],
                };
            }
        });
    }

    // Aggregate collection items, one file for each collection:

    consoleLog('  ', 'LOAD');

    Object.keys(collectionsIndex).forEach((c) => {
        const meta = collectionsIndex[c];

        consoleLog('    ', c);

        // Load in extra items manually added to the YAML file:

        _.uniq(meta.extra_items || []).forEach((e) => {
            const [u, , ...f] = e.split(path.sep);

            consoleLog('      ', 'Extra:', e);

            const { item } = loadItem(u, `${path.join(...f)}.yaml`);

            item.author = {
                name: u,
                url: userUrl(u),
            };

            meta.items.push(item);
        });

        // Load in item indexes for each member:

        _.uniq([userDir, ...(meta.admins || []), ...(meta.members || [])]).forEach((m) => {
            let page = 1;
            let pageCount = 1;
            do {
                const f = path.join(
                    cwd,
                    m,
                    'collections',
                    c,
                    `index${page === 1 ? '' : `_${page}`}.json`,
                );
                if (fs.existsSync(f)) {
                    consoleLog('      ', 'Import:', f);
                    const feed = JSON.parse(fs.readFileSync(f));
                    meta.items = meta.items.concat(feed.items);
                    pageCount = feed.pageCount;
                    page += 1;
                } else {
                    page = pageCount + 1;
                }
            } while (page <= pageCount);
        });

        meta.items = _.uniqBy(meta.items, 'id');

        if (_.isArray(meta.identifications)) {
            const idTags = meta.identifications.map(
                (i) => `id~${typeof i === 'string' ? i : i.name}`,
            );

            // Only keep items allowed in the collection:

            meta.items = meta.items.filter(
                (i) =>
                    _.isArray(i.tags) &&
                    i.tags.reduce((acc, t) => acc || idTags.includes(t), false),
            );

            // Remove all extra ids from the items:

            meta.items = meta.items.map((i) => ({
                ...i,
                tags: i.tags.filter((t) => !_.startsWith(t, 'id~') || idTags.includes(t)),
            }));

            const idTagsMap = meta.identifications.reduce((acc, i) => {
                if (typeof i === 'object' && i.name && _.isArray(i.tags)) {
                    acc[`id~${i.name}`] = i.tags.map((t) => `tag~${t}`);
                }
                return acc;
            }, {});

            if (Object.keys(idTagsMap).length !== 0) {
                // Add additional collection tags to items for each id:

                meta.items = meta.items.map((i) => ({
                    ...i,
                    tags: _.uniq(
                        i.tags.concat(
                            i.tags.reduce((acc, t) => {
                                if (idTagsMap[t]) {
                                    return acc.concat(idTagsMap[t]);
                                }
                                return acc;
                            }, []),
                        ),
                    ),
                }));
            }
        }

        if (_.isArray(meta.tags)) {
            const tagsFilter = meta.tags.map((t) => `tag~${t}`);

            if (_.isArray(meta.identifications)) {
                meta.identifications.forEach((i) => {
                    if (typeof i === 'object' && _.isArray(i.tags)) {
                        i.tags.forEach((t) => tagsFilter.push(`tag~${t}`));
                    }
                });
            }

            // Remove tags not listed on the collection:

            meta.items = meta.items.map((i) => ({
                ...i,
                tags: i.tags.filter((t) => !_.startsWith(t, 'tag~') || tagsFilter.includes(t)),
            }));
        }

        meta.items = sortFeedItems(_.uniqBy(meta.items, 'id'));

        if (meta.items.length !== 0) {
            // Aggregate index:

            writeFiles({
                userDir,
                subDir: path.join('collections', dirStr(c), 'aggregate'),
                feedItems: meta.items,
                _title: meta.title,
                _description: _stripTags(meta.description || ''),
                _display: {
                    ..._.pick(meta.display || {}, ['sort_by', 'sort_order', 'start_tags']),
                    description_html: markdown.render(_stripTags(meta.description || '')),
                },
            });
        }
    });

    // Index of all collections (this must be AFTER aggregation for accurate counts):

    writeFilesIndex({
        index: _.pickBy(
            _.mapValues(
                _.pickBy(collectionsIndex, (i) => !i.hide),
                'items',
            ),
            (i) => i.length !== 0,
        ),
        userDir,
        subDir: 'collections',
        _title: 'Collections',
        metaCb: (c) => {
            const meta = collectionsIndex[c];

            const filePath = path.join(
                userDir,
                'collections',
                dirStr(c),
                'aggregate',
                'index.json',
            );

            const id = new URL(path.join('.', filePath), contentHost).href;

            const uniqTags = meta.items.reduce((acc, i) => _.uniq([...acc, ...(i.tags || [])]), []);

            return omitNull({
                id,
                url: `${appHost}items?i=${encodeURIComponent(id)}`,
                title: meta.title,
                _geo: omitNull({
                    coordinates: coord([meta.longitude, meta.latitude]),
                }),
                _meta: omitNull({
                    name: c,
                    featured: meta.featured || null,
                    idCount: uniqTags.filter((t) => _.startsWith(t, 'id=')).length,
                    tagCount: uniqTags.filter((t) => _.startsWith(t, 'tag=')).length,
                }),
            });
        },
    });
};

const indexAll = () => {
    let index = {};

    glob.sync(path.join('*', 'collections', 'index.json'), { cwd }).forEach((f) => {
        // console.log(f);

        JSON.parse(fs.readFileSync(path.join(cwd, f))).items.forEach(({ title, ...collection }) => {
            const { name } = collection._meta;
            // console.log(' ->', name, '-', title);

            if (index[name] === undefined) index[name] = [];

            index[name].push({
                title: f.split(path.sep)[0],
                ...collection,
            });
        });
    });

    console.log(Object.keys(index).length, ' collections');

    index = _.mapValues(index, (i) => sortFeedItems(i));

    Object.keys(index).forEach((name) => {
        writeFiles({
            userDir: '_collections',
            subDir: name,
            feedItems: index[name],
            _title: _.startCase(name),
            _authorName: 'All Collections',
            _userUrl: `${appHost}collections`,
            _description: `All users for [${name}]`,
            _itemCountKey: 'userCount',
        });
    });

    const itemCounts = _.mapValues(index, (ary) => _.max(_.map(ary, '_meta.itemCount')));

    writeFilesIndex({
        index: _.pickBy(index, (v, k) => itemCounts[k] >= 10),
        userDir: '_collections',
        subDir: '.',
        _title: 'All Collections',
        _authorName: 'All Collections',
        _userUrl: `${appHost}collections`,
        metaCb: (name) => {
            const id =
                index[name].length === 1
                    ? index[name][0].id
                    : new URL(path.join('.', '_collections', name, 'index.json'), contentHost).href;
            return omitNull({
                id,
                url: `${appHost}items?i=${encodeURIComponent(id)}`,
                title: _.startCase(name),
                _meta: omitNull({
                    featured: false, // TODO
                    itemCount: itemCounts[name],
                    userCount: index[name].length,
                }),
            });
        },
    });
};

const buildAll = () => {
    glob.sync('*', { cwd })
        .filter(
            (f) =>
                f && f[0] !== '.' && f[0] !== '_' && fs.lstatSync(path.join(cwd, f)).isDirectory(),
        )
        .slice(0, 100000)
        .forEach(build);
};

if (process.argv.length === 3) {
    build(process.argv[2]);
} else {
    buildAll();
    indexAll();
}
