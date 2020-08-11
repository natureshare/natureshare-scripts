/* global process */

import dotenv from 'dotenv';
import Flickr from 'flickr-sdk';
import moment from 'moment';
import yaml from 'js-yaml';
import striptags from 'striptags';
import jsonschema from 'jsonschema';
import fs from 'fs';
import mkdirp from 'mkdirp';
import path from 'path';
import _omitBy from 'lodash/omitBy.js';
import _uniq from 'lodash/uniq.js';
import _isArray from 'lodash/isArray.js';

dotenv.config();

const validator = new jsonschema.Validator();
const itemSchema = yaml.safeLoad(fs.readFileSync('./schemas/item.yaml'));

const contentFilePath = process.env.CONTENT_FILE_PATH;

const _clean = (obj) =>
    _omitBy(
        obj,
        (i) => i === undefined || i === null || i === '' || (_isArray(i) && i.length === 0),
    );

const parseItemDescription = (str) => {
    if (str && str.length !== 0 && str.substr('--- #natureshare.org') !== -1) {
        const doc = str.split('---', 3)[1];
        if (doc && doc.length > 0) {
            const item = _clean(yaml.safeLoad(doc));
            const result = validator.validate(item, itemSchema, {
                throwError: false,
            });
            if (result.errors.length === 0) {
                return item;
            }
            console.log(result.errors);
        }
    }
    return null;
};

const coordValue = (v) => Math.round(parseFloat(v) * 1000000) / 1000000;

const parseFeedItem = (username, data) => {
    console.log(data.id);

    if (data.media_status === 'ready' && data.description && data.description._content) {
        const partialItem = parseItemDescription(striptags(data.description._content));

        if (partialItem) {
            // console.log(data);

            const createdAt = moment.unix(data.dateupload);
            const updatedAt = moment.unix(data.lastupdate);

            const dirPath = path.join(
                contentFilePath,
                username,
                'items',
                'flickr',
                `${createdAt.year()}`,
            );

            const filePath = path.join(dirPath, `${data.id}.yaml`);

            console.log('-->', filePath);

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

            if (partialItem.latitude) partialItem.latitude = coordValue(partialItem.latitude);

            if (partialItem.longitude) partialItem.longitude = coordValue(partialItem.longitude);

            const item = _clean({
                datetime: dateTaken,
                latitude:
                    data.latitude !== '0' && data.longitude !== '0'
                        ? coordValue(data.latitude)
                        : undefined,
                longitude:
                    data.latitude !== '0' && data.longitude !== '0'
                        ? coordValue(data.longitude)
                        : undefined,
                ...existingItem,
                ...partialItem,
                tags: _uniq([...(existingItem.tags || []), ...(partialItem.tags || []), 'flickr']),
                collections: _uniq([
                    ...(existingItem.collections || []),
                    ...(partialItem.collections || []),
                ]),
                photos,
                videos,
                created_at: createdAt.toISOString(),
                updated_at: updatedAt.toISOString(),
            });

            const doc = yaml.safeDump(item, {
                lineWidth: 1000,
                noRefs: true,
            });

            console.log('---');
            console.log(doc);

            validator.validate(item, itemSchema, { throwError: true });

            mkdirp.sync(dirPath);

            fs.writeFileSync(filePath, doc);
        }
    }
};

export const getPublicPhotos = (username, api, userId) => {
    // https://www.flickr.com/services/api/flickr.people.getPublicPhotos.html
    // console.log(userId);
    api.people
        .getPublicPhotos({
            user_id: userId,
            safe_search: 1,
            extras: 'description, date_upload, last_update, date_taken, geo, media, url_m, url_o',
            per_page: 100,
        })
        .then((response) =>
            response.body.photos.photo.forEach((data) => parseFeedItem(username, data)),
        )
        .catch((error) => console.log(error));
};

export const recentlyUpdated = (api, userId) => {
    // https://www.flickr.com/services/api/flickr.photos.recentlyUpdated.html
    const weekAgo = moment().subtract(7, 'days').unix();
    api.photos
        .recentlyUpdated({ user_id: userId, min_date: weekAgo })
        .then((res) => console.log(res.body.photos.photo))
        .catch((err) => console.log(err));
};

export default ({ username, oAuthKey, oAuthSecret, apiToken, apiSecret, userId }) => {
    const api = new Flickr(Flickr.OAuth.createPlugin(oAuthKey, oAuthSecret, apiToken, apiSecret));

    getPublicPhotos(username, api, userId);
};
