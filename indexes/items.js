/* global process */

import path from 'path';
import glob from 'glob';
import fs from 'fs';
import dotenv from 'dotenv';
import _startCase from 'lodash/startCase.js';
import _pickBy from 'lodash/pickBy.js';
import _mapValues from 'lodash/mapValues.js';
import { writeFiles, writeFilesForEach } from './utils/writeFiles.js';
import loadItem from './utils/loadItem.js';
import { userUrl, dirStr, sortFeedItems } from './utils/utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;

const run = (userDir) => {
    console.log(userDir);

    const itemsDir = path.join(cwd, userDir, 'items');

    if (fs.existsSync(itemsDir)) {
        const feedItems = [];
        const collectionsIndex = {};

        // Load each item:

        glob.sync(path.join('*', '*', '*.yaml'), { cwd: itemsDir }).forEach((f) => {
            const { item, collections } = loadItem(userDir, f);

            feedItems.push(item);

            if (collections) {
                collections.forEach((i) => {
                    if (collectionsIndex[i] === undefined) {
                        collectionsIndex[i] = {
                            title: _startCase(i),
                            extraItems: [],
                            members: [],
                            items: [],
                        };
                    }

                    const itemWithAuthor = {
                        ...item,
                        author: {
                            name: userDir,
                            url: userUrl(userDir),
                        },
                    };

                    collectionsIndex[i].items.push(itemWithAuthor);
                });
            }
        });

        // Items:

        writeFiles({
            userDir,
            subDir: 'items',
            _title: 'Items',
            feedItems: sortFeedItems(feedItems),
        });

        // User's collection items, one file for each collection:

        writeFilesForEach({
            index: _pickBy(
                _mapValues(collectionsIndex, (i) => sortFeedItems(i.items)),
                (i) => i.length !== 0,
            ),
            userDir,
            subDirCb: (i) => path.join('collections', dirStr(i)),
            titleCb: (i) => collectionsIndex[i].title,
            descriptionCb: (i) => collectionsIndex[i].description,
        });
    }
};

if (process.argv.length === 3) {
    run(process.argv[2]);
} else {
    glob.sync('*', { cwd })
        .filter(
            (f) =>
                f !== '_index' && f !== '_scripts' && fs.lstatSync(path.join(cwd, f)).isDirectory(),
        )
        .slice(0, 100000)
        .forEach(run);
}
