/* global process */

import dotenv from 'dotenv';
import Flickr from 'flickr-sdk';
import moment from 'moment';
import yaml from 'js-yaml';
import striptags from 'striptags';
import fs from 'fs';
import mkdirp from 'mkdirp';
import path from 'path';
import _uniq from 'lodash/uniq.js';
import _uniqBy from 'lodash/uniqBy.js';
import _sortBy from 'lodash/sortBy.js';
import { _clean, validateItem, parseItemDescription, getValidLocation } from './utils.js';

dotenv.config();

const oAuthKey = process.env.OAUTH_FLICKR_KEY;
const oAuthSecret = process.env.OAUTH_FLICKR_SECRET;

const contentFilePath = process.env.CONTENT_FILE_PATH;

const parseFeedItem = (username, data, titleMap) => {
    if (data.media_status === 'ready') {
        console.log('   ', data.title);

        const createdAt = moment.unix(data.dateupload);
        const updatedAt = moment.unix(data.lastupdate);

        const dirPath = path.join(
            contentFilePath,
            username,
            'items',
            'flickr',
            `${createdAt.year()}`,
        );

        let fileName = data.id;
        let partialItem = null;

        if (data.description && data.description._content) {
            partialItem = parseItemDescription(striptags(data.description._content));
        }

        if (!partialItem && data.title && /.+~[0-9]+$/.test(data.title)) {
            const targetId = titleMap[data.title.split('~', 1)[0]];
            if (targetId && fs.existsSync(path.join(dirPath, `${targetId}.yaml`))) {
                fileName = targetId;
                partialItem = {};
            }
        }

        if (partialItem) {
            const filePath = path.join(dirPath, `${fileName}.yaml`);

            console.log('      -->', filePath);

            const existingItem = fs.existsSync(filePath)
                ? yaml.safeLoad(fs.readFileSync(filePath))
                : {};

            const dateTaken =
                (data.datetakenunknown === '0' &&
                    data.datetaken &&
                    moment(data.datetaken).toISOString(true)) ||
                undefined;

            const href = `https://www.flickr.com/photos/${data.owner}/${data.id}`;

            const media = _clean({
                source: 'flickr',
                id: data.id,
                href,
                datetime: dateTaken,
                width: data.width_o,
                height: data.height_o,
                thumbnail_url: data.url_m,
                original_url: data.url_o,
            });

            const photos = [media];

            const videos =
                data.media === 'video'
                    ? [
                          _clean({
                              ...media,
                              original_url: null,
                          }),
                      ]
                    : [];

            const location = {
                latitude: null,
                longitude: null,
                ...getValidLocation(existingItem),
                ...getValidLocation(data),
                ...getValidLocation(partialItem),
            };

            const item = _clean({
                ...existingItem,
                ...partialItem,
                datetime: dateTaken || partialItem.datetime || existingItem.datetime,
                photos: _sortBy(_uniqBy([...(existingItem.photos || []), ...photos], 'id'), 'id'),
                videos: _sortBy(_uniqBy([...(existingItem.videos || []), ...videos], 'id'), 'id'),
                ...location,
                tags: _uniq([...(existingItem.tags || []), ...(partialItem.tags || []), 'flickr']),
                collections: _uniq([
                    ...(existingItem.collections || []),
                    ...(partialItem.collections || []),
                ]),
                created_at: createdAt.toISOString(true),
                updated_at: updatedAt.toISOString(true),
            });

            const doc = yaml.safeDump(item, {
                lineWidth: 1000,
                noRefs: true,
            });

            // console.log('---');
            // console.log(doc);

            validateItem(item, true);

            mkdirp.sync(dirPath);

            fs.writeFileSync(filePath, doc);
        }
    }
};

export const getPublicPhotos = async (username, api, userId) => {
    // https://www.flickr.com/services/api/flickr.people.getPublicPhotos.html
    // console.log(userId);
    try {
        const response = await api.people.getPublicPhotos({
            user_id: userId,
            safe_search: 1,
            extras: 'description, date_upload, last_update, date_taken, geo, media, url_m, url_o',
            per_page: 100,
        });

        const titleMap = response.body.photos.photo.reduce(
            (acc, i) => ({ ...acc, [i.title]: i.id }),
            {},
        );

        _sortBy(response.body.photos.photo, 'title').forEach((data) =>
            parseFeedItem(username, data, titleMap),
        );
    } catch (err) {
        console.log(err);
    }

    return true;
};

export const recentlyUpdated = (api, userId) => {
    // https://www.flickr.com/services/api/flickr.photos.recentlyUpdated.html
    const weekAgo = moment().subtract(7, 'days').unix();
    api.photos
        .recentlyUpdated({ user_id: userId, min_date: weekAgo })
        .then((res) => console.log(res.body.photos.photo))
        .catch((err) => console.log(err));
};

export default async ({ username, oauth }) => {
    const api = new Flickr(
        Flickr.OAuth.createPlugin(
            oAuthKey,
            oAuthSecret,
            oauth.oauth_token,
            oauth.oauth_token_secret,
        ),
    );

    await getPublicPhotos(username, api, oauth.user_nsid);
};
