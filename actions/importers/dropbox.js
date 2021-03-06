/* global process URL */
// https://dropbox.github.io/dropbox-sdk-js/Dropbox.html

import fetch from 'node-fetch';
import dbx from 'dropbox';
import path from 'path';
import fs from 'fs';
import mkdirp from 'mkdirp';
import moment from 'moment';
import yaml from 'js-yaml';
import _uniq from 'lodash/uniq.js';
import _uniqBy from 'lodash/uniqBy.js';
import _sortBy from 'lodash/sortBy.js';
import dotenv from '../../utils/dotenv.js';
import { _clean, itemIsValid, parseItemDescription, slugify, getValidLocation } from './utils.js';

dotenv.config();

const contentFilePath = process.env.CONTENT_FILE_PATH;
const photosHost = process.env.PHOTOS_HOST;

const imageFileRegExp = /\.(jpg|jpeg)$/i;

const forceUpdate = false;

export default async ({ username, oauth }) => {
    const dropbox = new dbx.Dropbox({
        fetch,
        accessToken: oauth.access_token,
    });

    const root = await dropbox.filesListFolder({ path: '' });

    for (const rootEntry of root.entries.filter((i) => i['.tag'] === 'folder')) {
        const dirName = slugify(path.basename(rootEntry.path_lower));

        const folder = await dropbox.filesListFolder({ path: rootEntry.path_lower });
        console.log(dirName, '::', folder.entries.length);

        // folder.entries.forEach(i => console.log(i.path_lower));

        const itemEntries = _sortBy(
            folder.entries.filter((i) => imageFileRegExp.test(i.path_lower)).slice(0, 100),
            'path_lower',
        );

        for (const entry of itemEntries) {
            console.log(entry.path_lower);

            const dataFileRegExp = new RegExp(
                `^${rootEntry.path_lower}/${
                    path.basename(entry.path_lower, path.extname(entry.path_lower)).split('~', 1)[0]
                }.(txt|yml|yaml)`,
            );

            const dataEntry = folder.entries.filter((i) => dataFileRegExp.test(i.path_lower))[0];

            if (!dataEntry) {
                console.log('   ', 'Not Found!');
            } else {
                console.log('   ', 'Found:', dataEntry.path_lower);

                const dirPath = path.join(contentFilePath, username, 'items', 'dropbox', dirName);

                const fileName = slugify(
                    path.basename(dataEntry.path_lower, path.extname(dataEntry.path_lower)),
                );

                const filePath = path.join(dirPath, `${fileName}.yaml`);

                const existingItem = fs.existsSync(filePath)
                    ? yaml.safeLoad(fs.readFileSync(filePath))
                    : {};

                const updatedAt = moment(
                    [entry.server_modified, dataEntry.server_modified].sort()[1],
                );

                const thumbnailFileName = slugify(
                    path.basename(entry.path_lower, path.extname(entry.path_lower)),
                );
                const thumbnailPath = path.join(dirPath, `${thumbnailFileName}.jpg`);
                const thumbnailUrl = new URL(
                    [username, 'items', 'dropbox', `${dirName}`, `${thumbnailFileName}.jpg`].join(
                        '/',
                    ),
                    photosHost,
                ).href;

                const isNewImageFile =
                    !existingItem.photos ||
                    !existingItem.photos[0] ||
                    existingItem.photos.filter((i) => i.thumbnail_url === thumbnailUrl).length ===
                        0;

                if (
                    forceUpdate ||
                    !existingItem.updated_at ||
                    updatedAt.isAfter(moment(existingItem.updated_at)) ||
                    isNewImageFile
                ) {
                    console.log('-->', filePath);

                    const dataFile = await dropbox.filesDownload({ path: dataEntry.path_lower });

                    const partialItem = parseItemDescription(
                        dataFile.fileBinary ? dataFile.fileBinary.toString() : null,
                    );

                    if (partialItem) {
                        const metadata = await dropbox.filesGetMetadata({
                            path: entry.path_lower,
                            include_media_info: true,
                        });

                        const { dimensions, location, time_taken: timeTaken } =
                            (metadata.media_info &&
                                metadata.media_info.metadata &&
                                metadata.media_info.metadata) ||
                            {};

                        const createdAt = timeTaken ? moment(timeTaken) : null;

                        const sharing = await dropbox.sharingGetSharedLinks({
                            path: entry.path_lower,
                        });

                        let shared = sharing.links.filter(
                            (i) => i.visibility['.tag'] === 'public',
                        )[0];

                        if (!shared) {
                            shared = await dropbox.sharingCreateSharedLinkWithSettings({
                                path: entry.path_lower,
                                settings: {
                                    requested_visibility: 'public',
                                },
                            });
                        }

                        const href = shared.url;
                        const originalUrl = shared.url.replace('dl=0', 'dl=1');

                        if (isNewImageFile) {
                            console.log('-->', thumbnailPath);

                            const thumbnail = await dropbox.filesGetThumbnail({
                                path: entry.path_lower,
                                size: 'w640h480',
                                mode: 'bestfit',
                            });

                            if (thumbnail.fileBinary) {
                                mkdirp.sync(dirPath);
                                fs.writeFileSync(thumbnailPath, thumbnail.fileBinary);
                            }
                        }

                        const photo = _clean({
                            source: 'dropbox',
                            id: entry.name,
                            href,
                            datetime: timeTaken ? moment(timeTaken).toISOString(true) : null,
                            width: dimensions ? dimensions.width : null,
                            height: dimensions ? dimensions.height : null,
                            thumbnail_url: thumbnailUrl,
                            original_url: originalUrl,
                        });

                        const itemLocation = {
                            latitude: null,
                            longitude: null,
                            ...getValidLocation(existingItem, false),
                            ...getValidLocation(location, true),
                            ...getValidLocation(partialItem, false),
                        };

                        const item = _clean({
                            ...existingItem,
                            ...partialItem,
                            ...itemLocation,
                            datetime:
                                (timeTaken ? moment(timeTaken).toISOString(true) : null) ||
                                partialItem.datetime ||
                                existingItem.datetime,
                            photo_datetime_used: Boolean(timeTaken),
                            tags: _uniq(
                                [
                                    ...(existingItem.tags || []),
                                    ...(partialItem.tags || []),
                                    'dropbox',
                                ]
                                    .filter(Boolean)
                                    .sort(),
                            ),
                            collections: _uniq(
                                [
                                    ...(existingItem.collections || []),
                                    ...(partialItem.collections || []),
                                ]
                                    .filter(Boolean)
                                    .sort(),
                            ),
                            photos: _sortBy(
                                _uniqBy([...(existingItem.photos || []), photo], 'id'),
                                'id',
                            ),
                            created_at: createdAt.toISOString(),
                            updated_at: updatedAt.toISOString(),
                        });

                        if (itemIsValid(item)) {
                            const doc = yaml.safeDump(item, {
                                lineWidth: 1000,
                                noRefs: true,
                            });
                            mkdirp.sync(dirPath);
                            fs.writeFileSync(filePath, doc);
                        }
                    }
                }
            }
        }
    }

    return true;
};
