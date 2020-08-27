/* global process */
/* eslint-disable no-loop-func */

import glob from 'glob';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import fetch from 'node-fetch';
import dotenv from '../utils/dotenv.js';

dotenv.config();

const cwd = path.join('..', 'natureshare-files');

const missingThumbnails = [];
const missingItems = [];

let queue = 0;

function sleep() {
    return new Promise((resolve) => {
        setTimeout(resolve, 10);
    });
}

const run = async (userDir) => {
    console.log(userDir);

    const itemsDir = path.join(cwd, userDir, 'items');

    if (fs.existsSync(itemsDir)) {
        for (const f of glob.sync(path.join('*', '*', '*.yaml'), { cwd: itemsDir })) {
            const { photos } = yaml.safeLoad(fs.readFileSync(path.join(itemsDir, f)));

            if (photos) {
                for (const { original_url: originalUrl, thumbnail_url: thumbnailUrl } of photos) {
                    if (thumbnailUrl) {
                        process.stdout.write('.');

                        const thumbnailUrlS3 = thumbnailUrl.replace(
                            'https://photos.natureshare.org.au/',
                            process.env.PHOTOS_S3_URL,
                        );

                        fetch(thumbnailUrlS3, { method: 'HEAD' })
                            .then((response) => {
                                queue -= 1;
                                if (!response.ok) {
                                    console.log();
                                    console.log(' ', response.status, response.url);

                                    missingThumbnails.push(originalUrl);

                                    fs.writeFileSync(
                                        path.join(
                                            process.env.PHOTOS_RESIZED_DIR,
                                            'missing-thumbnails.json',
                                        ),
                                        JSON.stringify(missingThumbnails, null, 1),
                                    );

                                    missingItems.push(path.join(itemsDir, f));

                                    fs.writeFileSync(
                                        path.join(
                                            process.env.PHOTOS_RESIZED_DIR,
                                            'missing-items.json',
                                        ),
                                        JSON.stringify(missingItems, null, 1),
                                    );
                                }
                            })
                            .catch((err) => {
                                console.log();
                                console.error(err);
                                queue -= 1;
                            });

                        queue += 1;

                        while (queue > 5) {
                            await sleep();
                        }
                    }
                }
            }
        }
    }

    while (queue > 0) {
        await sleep();
    }

    console.log();

    return 'done';
};

const runAllUsers = async () => {
    const userDirs = glob
        .sync('*', { cwd })
        .filter(
            (f) =>
                f && f[0] !== '.' && f[0] !== '_' && fs.lstatSync(path.join(cwd, f)).isDirectory(),
        )
        .slice(0, 100000);

    for (const userDir of userDirs) {
        await run(userDir);
    }

    return 'done';
};

const runPromise = process.argv.length === 3 ? run(process.argv[2]) : runAllUsers();

runPromise
    .then((done) => {
        console.log(done);
    })
    .catch(console.error);
