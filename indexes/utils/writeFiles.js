/* global process URL */

import path from 'path';
import mkdirp from 'mkdirp';
import jsonschema from 'jsonschema';
import dotenv from 'dotenv';
import fs from 'fs';
import jsonfeedToRSS from 'jsonfeed-to-rss';
import jsonfeedToAtom from 'jsonfeed-to-atom';
import _range from 'lodash/range.js';
import omitNull from './omitNull.js';
import { sortFeedItems } from './utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const appHost = process.env.APP_HOST || 'https://natureshare.org.au';
const contentHost = process.env.CONTENT_HOST;

const validator = new jsonschema.Validator();
const geoSchema = JSON.parse(fs.readFileSync('./schemas/geo.json'));
const feedSchema = JSON.parse(fs.readFileSync('./schemas/feed.json'));

const validate = (obj, schema) => {
    const result = validator.validate(obj, schema, { throwError: false });
    if (result.errors && result.errors.length !== 0) {
        ['property', 'message', 'instance', 'schema'].forEach((i) =>
            console.log(JSON.stringify(result.errors[0][i], null, 4)),
        );
        throw new Error('Failed validation!');
    }
};

const getFirst = (ary, prop) => {
    try {
        return ary.filter((x) => x[prop])[0][prop];
    } catch (e) {
        return null;
    }
};

const coord = (ary) =>
    ary.reduce((acc, val) => acc && Boolean(parseFloat(val)), true)
        ? ary.map((v) => Math.round(parseFloat(v) * 1000) / 1000)
        : null;

const average = (ary) => ary.reduce((a, b) => a + b, 0) / ary.length;

export const averageCoord = (items) => {
    const coordAry = items.map((i) => i._geo.coordinates).filter(Boolean);

    return coord([average(coordAry.map((i) => i[0])), average(coordAry.map((i) => i[1]))]);
};

const PER_PAGE = 1000;

export const writeFiles = ({
    userDir,
    subDir,
    feedItems,
    _title,
    _description,
    _homePageUrl,
    _userUrl,
}) => {
    const fileDir = path.join(userDir, '_index', subDir);
    const feedUrl = new URL(path.join('.', fileDir, 'index.json'), contentHost).href;
    const homePageUrl = `${appHost}items?i=${encodeURIComponent(feedUrl)}`;
    const userUrl = `${appHost}items?i=${encodeURIComponent(
        new URL(path.join('.', userDir, '_index', 'items', 'index.json'), contentHost).href,
    )}`;

    mkdirp.sync(path.join(cwd, fileDir));

    _range(1, Math.ceil(feedItems.length / PER_PAGE) + 1).forEach((page) => {
        const fileName = `index${page === 1 ? '' : `_${page}`}`;

        const feed = {
            version: 'https://jsonfeed.org/version/1',
            title: _title || fileDir,
            description: _description || '',
            author: {
                name: userDir,
                url: _userUrl || userUrl,
            },
            home_page_url: _homePageUrl || homePageUrl,
            feed_url: feedUrl,
            next_url: new URL(path.join('.', fileDir, `index_${page + 1}.json`), contentHost).href,
            items: feedItems.slice((page - 1) * PER_PAGE, page * PER_PAGE),
            _meta: {
                itemCount: feedItems.length,
                pageNumber: page,
                pageCount: Math.ceil(feedItems.length / PER_PAGE),
            },
        };

        if (page === 1) {
            validate(feed, feedSchema);
        }

        fs.writeFileSync(
            path.join(cwd, fileDir, `${fileName}.json`),
            JSON.stringify(feed, null, 1),
        );

        fs.writeFileSync(
            path.join(cwd, fileDir, `${fileName}.rss.xml`),
            jsonfeedToRSS(feed, {
                feedURLFn: (feedURL) => feedURL.replace(/\.json\b/, '.rss.xml'),
            }),
        );

        fs.writeFileSync(
            path.join(cwd, fileDir, `${fileName}.atom.xml`),
            jsonfeedToAtom(feed, {
                feedURLFn: (feedURL) => feedURL.replace(/\.json\b/, '.atom.xml'),
            }),
        );
    });

    if (feedItems.length !== 0) {
        const geo = {
            type: 'FeatureCollection',
            features: feedItems
                .filter(({ _geo }) => _geo && _geo.coordinates)
                .map(({ id, url, title: itemTitle, image, _geo, _meta }) => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: _geo.coordinates,
                    },
                    properties: omitNull({
                        id,
                        url,
                        date: _meta.date,
                        title: itemTitle,
                        image,
                    }),
                })),
        };

        validate(geo, geoSchema);

        fs.writeFileSync(path.join(cwd, fileDir, 'index.geo.json'), JSON.stringify(geo, null, 1));
    }
};

export const writeFilesForEach = ({ index, userDir, subDirCb, titleCb, descriptionCb }) =>
    Object.keys(index).forEach((i) => {
        writeFiles({
            userDir,
            subDir: subDirCb(i),
            feedItems: index[i],
            _title: (titleCb && titleCb(i)) || i,
            _description: descriptionCb && descriptionCb(i),
        });
    });

export const writeFilesIndex = ({ index, userDir, subDir, _title, metaCb }) => {
    const feedItems = sortFeedItems(
        Object.keys(index).map((i) => {
            const { _geo, _meta, ...mixin } = metaCb ? metaCb(i) : {};
            return omitNull({
                title: i.replace(/_/g, ' '),
                content_text: `${index[i].length} items`,
                image: getFirst(index[i], 'image'),
                date_published: getFirst(index[i], 'date_published'),
                date_modified: getFirst(index[i], 'date_published'),
                _geo: {
                    coordinates: averageCoord(index[i]),
                    ...(_geo || {}),
                },
                _meta: {
                    itemCount: index[i].length,
                    date: (getFirst(index[i], 'date_published') || '').split('T', 1)[0],
                    ...(_meta || {}),
                },
                ...mixin,
            });
        }),
    );

    writeFiles({
        userDir,
        subDir,
        _title,
        feedItems,
    });
};
