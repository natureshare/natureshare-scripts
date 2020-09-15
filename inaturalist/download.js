/* global URL */

import fetch from 'node-fetch';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import mkdirp from 'mkdirp';
import yargs from 'yargs';
import _snakeCase from 'lodash/snakeCase.js';
import _uniq from 'lodash/uniq.js';
import _stripTags from 'underscore.string/stripTags.js';
import { itemIsValid } from '../actions/importers/utils.js';
import { sleep, observationToItem, makeTag } from '../actions/importers/inaturalist.js';

const { argv } = yargs;

function randomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

async function apiFetch(urlPath) {
    const cacheFilePath = `${path.join('_cache', 'api.inaturalist.org', 'v1', urlPath)}.json`;
    if (fs.existsSync(cacheFilePath)) {
        return JSON.parse(fs.readFileSync(cacheFilePath));
    }
    const sec = randomInt(6 / 2);
    console.log('Sleep', sec, 'seconds...');
    await sleep(sec);
    const url = new URL(urlPath, 'https://api.inaturalist.org/v1/');
    const response = await fetch(url.href, {
        headers: {
            'User-Agent': 'natureshare.org',
        },
    });
    if (response.ok) {
        const data = await response.json();
        mkdirp.sync(path.dirname(cacheFilePath));
        fs.writeFileSync(cacheFilePath, JSON.stringify(data));
        return data;
    }
    return null;
}

function firstResult(data) {
    if (data && data.results && data.results.length !== 0) {
        return data.results[0];
    }
    return null;
}

async function makeItem(observation) {
    // console.log(observation);
    const item = observationToItem(observation);
    item.tags = [];
    item.description =
        (observation.taxon && _stripTags(observation.taxon.wikipedia_summary)) || '-';
    if (observation.taxon) {
        if (observation.taxon.wikipedia_url) {
            item.source = [
                ...(item.source || []),
                {
                    name: 'Wikipedia',
                    href: observation.taxon && observation.taxon.wikipedia_url,
                },
            ];
        }
        const taxon = firstResult(await apiFetch(`taxa/${observation.taxon.id}`));
        if (taxon && taxon.ancestors) {
            // console.log(taxon);
            const byRank = taxon.ancestors.reduce((acc, i) => ({ ...acc, [i.rank]: i }), {});
            const tagPath = [
                byRank.kingdom,
                byRank.phylum,
                // byRank.subphylum,
                byRank.class,
                byRank.order,
                byRank.family,
                // byRank.subfamily,
                // byRank.genus,
            ].map((i) => makeTag((i && (i.preferred_common_name || i.name)) || 'other'));
            item.tags = [
                ...(item.tags || []),
                // ...tagPath.slice(0, tagPath.length-1).map((i, n, ary) => ary.slice(0, n+1).join('~') + '~all'),
                tagPath.join('~'),
            ];
            if (argv.rarity) {
                if (byRank.genus && byRank.genus.observations_count) {
                    item.tags = [
                        ...(item.tags || []),
                        `rarity~${byRank.genus.observations_count.toString().length}`,
                    ];
                }
            }
        }
    }
    item.license = 'CC BY 4.0';
    return item;
}

function writeItemFile({ dirPath, id, item }) {
    if (item && item.photos && item.photos.length === 0) {
        console.log(id, '--> No Photos!');
    } else if (item && itemIsValid(item)) {
        mkdirp.sync(dirPath);
        const fileName = _snakeCase(
            [item.id[0].name, item.id[0].common, id].filter(Boolean).join(' '),
        );
        const doc = yaml.safeDump(item, {
            lineWidth: 1000,
            noRefs: true,
        });
        fs.writeFileSync(path.join(dirPath, `${fileName}.yaml`), doc);
        console.log(id, '-->', path.join(dirPath, `${fileName}.yaml`));
        return 'Done.';
    } else {
        // console.log(JSON.stringify(item, null, 4));
        console.log(id, '--> Invalid!');
    }
    return 'Done';
}

async function downloadId({ dirPath, id, collection }) {
    return writeItemFile({
        dirPath,
        id,
        item: {
            ...(await makeItem(firstResult(await apiFetch(`observations/${id}`)))),
            collections: [collection],
        },
    });
}

async function fromCollectionYaml(filePath) {
    const doc = yaml.safeLoad(fs.readFileSync(filePath));
    const collection = path.basename(filePath, '.yaml');
    const dirPath = path.join(filePath, '..', '..', 'items', 'inaturalist', collection);
    for (const id of _uniq(
        doc.source_data.inaturalist.map((i) => parseInt(i, 10)).filter(Boolean),
    )) {
        await downloadId({ id, collection, dirPath });
    }
    return 'Done';
}

if (argv.f) {
    fromCollectionYaml(argv.f).then(console.log).then(console.error);
} else if (argv.dirPath && argv.id && argv.collection) {
    downloadId(argv).then(console.log).then(console.error);
}
