/* global URL */

import fetch from 'node-fetch';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import mkdirp from 'mkdirp';
import yargs from 'yargs';
import _uniq from 'lodash/uniq.js';
import _last from 'lodash/last.js';
import cheerio from 'cheerio';
import moment from 'moment';
import { sleep } from '../actions/importers/inaturalist.js';
import { writeItemFile } from './utils.js';
import dms from './dms.js';
import { _clean, getValidLocation } from '../actions/importers/utils.js';

const { argv } = yargs;

const wikiHost = 'en.wikipedia.org';

function randomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

async function fetchHtml(urlPath) {
    const cacheFilePath = `${path.join('_cache', wikiHost, 'wiki', urlPath)}.html`;
    if (fs.existsSync(cacheFilePath)) {
        return fs.readFileSync(cacheFilePath);
    }
    const url = new URL(`/wiki/${urlPath}`, `https://${wikiHost}`);
    console.log(url.href);
    const sec = randomInt(6 / 2);
    console.log('Sleep', sec, 'seconds...');
    await sleep(sec);
    const response = await fetch(url.href, {
        headers: {
            'User-Agent': 'natureshare.org',
        },
    });
    if (response.ok) {
        const data = await response.text();
        mkdirp.sync(path.dirname(cacheFilePath));
        fs.writeFileSync(cacheFilePath, data);
        return data;
    }
    return null;
}

async function makeItem(html) {
    if (html) {
        const $ = cheerio.load(html);
        const h1 = $('h1')
            .first()
            .text()
            .replace('(tree)', 'Tree')
            .replace('(sequoia tree)', 'Tree');
        const latitude = parseFloat(dms($('.latitude').first().text()));
        const longitude = parseFloat(dms($('.longitude').first().text()));
        const tags = [];
        // $('table.wikitable tr').each((i, row) => {
        //     const $tr = $(row);
        //     const f = $tr.find('th').first().text().toLowerCase().split('[', 1)[0].split('(', 1)[0].trim();
        //     // console.log(f);
        //     if (f === 'height above base') {
        //         tags.push(`height~${getInt($tr.find('td').last().text())}`);
        //     }
        //     if (f === 'circumference at ground') {
        //         tags.push(`girth~${getInt($tr.find('td').last().text())}`);
        //     }
        //     if (f === 'estimated bole volume' || f === 'estimated volume') {
        //         tags.push(`volume~${getInt($tr.find('td').last().text())}`);
        //     }
        // });
        // console.log(tags);
        const photoHref = $('.tright a.image, .vcard a.image').first().attr('href');
        const photos = [];
        if (photoHref) {
            const photoHtml = await fetchHtml(photoHref.replace('/wiki/', ''));
            if (photoHtml) {
                const $photo = cheerio.load(photoHtml);
                const originalUrl = $photo('.fullImageLink a').attr('href');
                const thumbnailUrl = $photo('.fullImageLink img').attr('src');
                let attribution = '';
                $photo('.commons-file-information-table tr').each((i, row) => {
                    const $tr = $(row);
                    const f = $tr.find('td').first().text().toLowerCase();
                    if (f === 'author') {
                        attribution =
                            $tr.find('td:last-child a:first-child').first().text() ||
                            $tr.find('td:last-child').first().text();
                    }
                });
                if (thumbnailUrl) {
                    photos.push({
                        source: 'wikipedia',
                        href: new URL(photoHref, `https://${wikiHost}`).href,
                        original_url: new URL(originalUrl, `https://${wikiHost}`).href,
                        thumbnail_url: new URL(thumbnailUrl, `https://${wikiHost}`).href,
                        attribution,
                    });
                }
            } else {
                console.log('no content');
            }
        }
        return _clean({
            id: [h1],
            ...getValidLocation({ latitude, longitude }),
            tags,
            photos,
            license: 'CC BY-SA 4.0',
            created_at: moment().toISOString(),
            updated_at: moment().toISOString(),
        });
    }
    return {};
}

async function download({ dirPath, src, collection, extraTags }) {
    const id = _last(src.split('/'));
    const item = await makeItem(await fetchHtml(src));
    console.log(extraTags[src]);
    return writeItemFile({
        dirPath,
        id,
        item: _clean({
            ...item,
            collections: [collection],
            tags: _uniq([...(item.tags || []), ...(extraTags[src] || [])]),
            source: [
                { name: 'Wikipedia', href: new URL(`/wiki/${src}`, `https://${wikiHost}`).href },
            ],
        }),
    });
}

const sizeTag = (str) =>
    str
        .toLowerCase()
        .replace(/[^a-z0-9().]/g, '')
        .replace(/\(/g, '_(')
        .replace('cuft', 'ft3');

async function getExtraTags() {
    const html = await fetchHtml('List_of_largest_giant_sequoias');
    const $ = cheerio.load(html);
    const tags = {};
    $('table.wikitable tr').each((i, row) => {
        const $tr = $(row);
        const name = `_${$tr
            .find('td:nth-child(2) a')
            .first()
            .text()
            .replace(/\s+/g, '_')
            .replace('(sequoia tree)', 'Tree')}_Tree`;
        const href = ($tr.find('td:nth-child(2) a').first().attr('href') || '').replace(
            '/wiki/',
            '',
        );
        if (href) {
            // console.log(n);
            tags[href] = [
                `groves~${$tr.find('td:nth-child(3)').text().trim().replace(/\s+/g, '_')}`,
                `height~${sizeTag($tr.find('td:nth-child(5)').text().trim())}${name}`,
                `girth~${sizeTag($tr.find('td:nth-child(6)').text().trim())}${name}`,
                `diameter~${sizeTag($tr.find('td:nth-child(7)').text().trim())}${name}`,
                `volume~${sizeTag($tr.find('td:nth-child(8)').text().trim())}${name}`,
            ];

            tags[href.replace('(tree)', 'Tree')] = tags[href];
        }
    });

    const parks = {
        'park~Sequoia_National_Park': [
            'General_Sherman_(tree)',
            'President_(tree)',
            'Lincoln_(tree)',
            'Franklin_(tree)',
            'King_Arthur_(tree)',
            'Monroe_(tree)',
            'Floyd_Otter_(tree)',
            'John_Adams_(tree)',
            'Ishi_Giant',
            'Column_(tree)',
            'Pershing_(tree)',
            'Diamond_(tree)',
            'Above_Diamond',
            'Chief_Sequoyah_(tree)',
            'Methuselah_(sequoia_tree)',
            'Sentinel_(tree)',
        ],
        'park~Kings_Canyon_National_Park': [
            'General_Grant_(tree)',
            'Robert_E._Lee_(tree)',
            'Hart_(tree)',
        ],
        'park~Giant_Sequoia_National_Monument': [
            'Boole_(tree)',
            'King_Arthur_(tree)',
            'Adam_(tree)',
        ],
        'park~Yosemite_National_Park': ['Washington_Tree_(Mariposa_Grove)', 'Grizzly_Giant'],
    };

    Object.keys(parks).forEach((park) => {
        parks[park].forEach((i) => {
            tags[i].push(park);
        });
    });

    return tags;
}

async function fromCollectionYaml(filePath) {
    const extraTags = await getExtraTags();
    // return extraTags;
    const doc = yaml.safeLoad(fs.readFileSync(filePath));
    const collection = path.basename(filePath, '.yaml');
    const dirPath = path.join(filePath, '..', '..', 'items', 'wikipedia', collection);
    for (const src of _uniq(doc.wikipedia.map((i) => i.trim()).filter(Boolean))) {
        console.log();
        console.log('>>', src);
        await download({ src, collection, dirPath, extraTags });
    }
    console.log();
    return 'Done';
}

if (argv.f) {
    fromCollectionYaml(argv.f).then(console.log).then(console.error);
} else if (argv.dirPath && argv.id && argv.collection) {
    download(argv).then(console.log).then(console.error);
}
