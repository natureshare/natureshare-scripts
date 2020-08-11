/* global process URL */

import path from 'path';
import glob from 'glob';
import fs from 'fs';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import _pickBy from 'lodash/pickBy.js';
import moment from 'moment';
import { writeFiles, averageCoord } from './utils/writeFiles.js';
import { sortFeedItems } from './utils/utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const appName = process.env.APP_NAME || 'NatureShare';
const appHost = process.env.APP_HOST || 'https://natureshare.org.au/';
const contentHost = process.env.CONTENT_HOST || 'https://files.natureshare.org.au/';

const items = [];

glob.sync(path.join('*'), { cwd })
    .filter((f) => f !== '_index' && fs.lstatSync(path.join(cwd, f)).isDirectory())
    .slice(0, 100000)
    .forEach((username) => {
        const filePath = path.join(username, 'profile.yaml');

        if (!fs.existsSync(path.join(cwd, filePath))) {
            console.log(username);
            console.log(' --> Profile not found!');
        } else {
            const profile = yaml.safeLoad(fs.readFileSync(path.join(cwd, filePath)));

            const id = new URL(
                path.join('.', username, '_index', 'items', 'index.json'),
                contentHost,
            ).href;

            let image = null;
            let datePublished = (profile.joined
                ? moment([parseInt(profile.joined, 10), 0, 1, 0, 0, 0])
                : moment()
            ).toISOString(true);
            let dateModified = datePublished;
            let itemCount = 0;
            let coordinates = null;

            const indexFile = path.join(cwd, username, '_index', 'items', 'index.json');

            if (fs.existsSync(indexFile)) {
                const { items: recentItems, _meta: meta } = JSON.parse(fs.readFileSync(indexFile));
                datePublished = recentItems[0].date_published;
                dateModified = recentItems[0].date_modified;
                image = (recentItems.filter((i) => i.image)[0] || {}).image;
                itemCount = (meta && meta.itemCount) || 0;
                coordinates = averageCoord(recentItems);
            }

            items.push(
                _pickBy(
                    {
                        id,
                        url: `${appHost}items?i=${encodeURIComponent(id)}`,
                        title: profile.name || username,
                        image,
                        content_text: (profile.bio || '-').slice(0, 255),
                        date_published: datePublished,
                        date_modified: dateModified,
                        _geo: {
                            coordinates,
                        },
                        _meta: _pickBy(
                            {
                                itemCount,
                                date: (dateModified && dateModified.split('T', 1)[0]) || null,
                            },
                            Boolean,
                        ),
                    },
                    Boolean,
                ),
            );
        }
    });

writeFiles({
    userDir: appName,
    subDir: '../..', // bit of hack
    appView: 'profile',
    feedItems: sortFeedItems(items),
    _title: appName,
    _homePageUrl: appHost,
    _userUrl: appHost,
});
