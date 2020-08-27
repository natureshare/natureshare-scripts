/* global process */

import path from 'path';
import fs from 'fs';
import mkdirp from 'mkdirp';
import sharp from 'sharp';
import dotenv from '../utils/dotenv.js';

dotenv.config();

const resize = (url, inFilePath, outFilePath, width, height) =>
    new Promise((resolve) => {
        // https://sharp.pixelplumbing.com/api-resize
        sharp(inFilePath)
            .rotate()
            .resize({
                width,
                height,
                fit: sharp.fit.inside,
            })
            .toFormat('jpg')
            .toFile(outFilePath, (err) => {
                if (err) {
                    console.log(url);
                    console.log(' -> ERROR');
                }
                resolve();
            });
    });

const run = async () => {
    const missing = JSON.parse(
        fs.readFileSync(path.join(process.env.PHOTOS_RESIZED_DIR, 'missing-thumbnails.json')),
    );

    for (const url of missing) {
        const filePath = url
            .replace('https://photos.natureshare.org.au/user_generated_content/original/', '')
            .split('/')
            .map(decodeURIComponent);

        const orig = path.join(process.env.PHOTOS_ORIGINAL_DIR, ...filePath);

        const newThumb = path.join(process.env.PHOTOS_RESIZED_DIR, 'h=640&w=640', ...filePath);

        if (!fs.existsSync(orig)) {
            console.log(url);
            console.log(' -> MISSING');
        } else {
            mkdirp.sync(path.dirname(newThumb));
            await resize(url, orig, newThumb, 640, 640);
        }
    }
    return 'done';
};

run().then(console.log).catch(console.error);
