// https://www.inaturalist.org/oauth/applications/492
// https://www.inaturalist.org/pages/api+reference#post-observations
// https://www.inaturalist.org/pages/api+reference#post-observation_photos
// https://api.inaturalist.org/v1/docs/#!/Observations/post_observations
// https://api.inaturalist.org/v1/docs/#/Observation_Photos
// https://github.com/inaturalist/inaturalist/blob/master/app/controllers/observation_photos_controller.rb
// https://www.inaturalist.org/pages/api+recommended+practices

/* global process URL URLSearchParams */
/* eslint-disable camelcase */

import fetch from 'node-fetch';
import path from 'path';
import glob from 'glob';
import fs from 'fs';
import mkdirp from 'mkdirp';
import moment from 'moment';
import yaml from 'js-yaml';
import FormData from 'form-data';
import _uniq from 'lodash/uniq.js';
import _isArray from 'lodash/isArray.js';
import dotenv from '../../utils/dotenv.js';
import { _clean, itemIsValid, getValidLocation } from './utils.js';

dotenv.config();

const appHost = process.env.APP_HOST;
const contentFilePath = process.env.CONTENT_FILE_PATH;

const enableUploads = true;
const enableUpdates = true;

const webHost = 'https://www.inaturalist.org';
const apiHost = 'https://api.inaturalist.org';
const userAgent = 'NatureShare.org';

export async function sleep(seconds) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), seconds * 1000);
    });
}

async function throwErrorIfTooManyRequests(response) {
    if (response && !response.ok) {
        console.error(response.status);
        console.error(await response.text());
        if (parseInt(response.status, 10) === 429) {
            throw new Error('Too Many Requests!');
        }
    }
    await sleep(1);
    return true;
}

async function authFetch({ host, pathname, search, token }) {
    const url = new URL(pathname, host);
    if (search) url.search = new URLSearchParams(search);
    const response = await fetch(url.href, {
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': userAgent,
        },
    });
    if (response.ok) {
        const body = await response.json();
        return body;
    }
    console.error(response.status, url.href);
    return null;
}

async function apiFetch({ pathname, token, search }) {
    return authFetch({ host: apiHost, pathname, search, token });
}
const licenseMap = {
    null: 'reserved',
    cc0: 'CC0',
};

const license = (str) =>
    licenseMap[str] ||
    (str && typeof str === 'string' && str.toUpperCase().replace(/^CC-/, 'CC ')) ||
    null;

export const makeTag = (str) =>
    str
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9-_.~]/g, '')
        .replace(/_+/, '_');

export function observationToItem({
    uri,
    time_observed_at,
    location,
    public_positional_accuracy,
    place_guess,
    description,
    tags,
    identifications,
    taxon,
    photos,
    license_code,
    created_at,
    updated_at,
}) {
    return _clean({
        id: taxon && [
            _clean({
                name: taxon.name,
                common: taxon.preferred_common_name,
                by:
                    identifications &&
                    _uniq(
                        identifications
                            .filter((i) => i.taxon.name === taxon.name)
                            .map((i) => i.user.login),
                    ),
                ref: { inaturalist: taxon.id },
            }),
        ],
        datetime: time_observed_at,
        ...getValidLocation({
            latitude: (location || '').split(',', 2)[0],
            longitude: (location || '').split(',', 2)[1],
        }),
        location_name: place_guess,
        accuracy: public_positional_accuracy,
        description,
        tags: ['inaturalist', ...(tags ? tags.map((i) => makeTag(i)) : [])],
        photos: (photos || []).map((i) =>
            _clean({
                source: 'iNaturalist',
                id: `${i.id}`,
                width: i.original_dimensions && i.original_dimensions.width,
                height: i.original_dimensions && i.original_dimensions.height,
                thumbnail_url: i.url && i.url.replace('/square', '/medium'),
                original_url: i.url && i.url.replace('/square', '/original'),
                license: license(i.license_code),
                attribution: i.attribution.replace(/^\(c\)\s/, '').split(',', 1)[0],
                href: `https://www.inaturalist.org/photos/${i.id}`,
            }),
        ),
        license: license(license_code),
        created_at,
        updated_at,
        source: [
            {
                name: 'iNaturalist',
                href: uri, // `https://www.inaturalist.org/observations/${id}`,
            },
        ],
    });
}

export async function userImportObservations({ username, userId, userLogin, token }) {
    if (!userId && !userLogin) throw new Error('userId or userLogin is required!');

    let quota = 10000;
    let lastId = null;

    const itemsDir = path.join(process.env.CONTENT_FILE_PATH, username, 'items');
    const indexFilePath = path.join(itemsDir, 'inaturalist.yaml');

    const index = fs.existsSync(indexFilePath) ? yaml.safeLoad(fs.readFileSync(indexFilePath)) : {};

    try {
        do {
            console.log('lastId', lastId, 'quota', quota);

            const data = await apiFetch({
                pathname: '/v1/observations',
                search: {
                    ...(userId ? { user_id: userId } : {}),
                    ...(userLogin ? { user_login: userLogin } : {}),
                    // updated_since: todo
                    ...(lastId ? { id_below: lastId } : {}),
                    order_by: 'id',
                    order: 'desc',
                    per_page: 200,
                },
                token,
            });

            if (data.results.length === 0) {
                console.log(' -> No data');
                quota = 0;
            } else {
                for (const observation of data.results) {
                    const { id, ofvs, created_at, updated_at } = observation;

                    lastId = id;
                    quota -= 1;

                    console.log(' -> Observation', id);

                    const natureShareUrls =
                        (ofvs &&
                            ofvs.filter((i) => i.name === 'NatureShare URL').map((i) => i.value)) ||
                        [];

                    if (natureShareUrls.length !== 0) {
                        const url = new URL(natureShareUrls[0]);

                        let filePath = null;

                        if (/\/observations\/[a-f0-9]+/.test(url.pathname)) {
                            const fileId = url.pathname.split('/')[2];
                            const fileSearch = glob.sync(path.join('ns', '*', `${fileId}.yaml`), {
                                cwd: itemsDir,
                            });
                            if (fileSearch.length !== 0) {
                                [filePath] = fileSearch;
                            }
                        } else if (url.search) {
                            filePath = new URLSearchParams(url.search)
                                .get('i')
                                .replace(new RegExp(`^${process.env.CONTENT_HOST}`), '')
                                .replace(new RegExp(`^[./]*${username}/items/`), '');
                        }

                        console.log('  -->', filePath);

                        if (filePath && !index[filePath]) {
                            index[filePath] = [id, updated_at];
                        }
                    } else {
                        const item = observationToItem(observation);

                        if (itemIsValid(item)) {
                            const doc = yaml.safeDump(item, {
                                lineWidth: 1000,
                                noRefs: true,
                            });

                            const dirPath = path.join(
                                contentFilePath,
                                username,
                                'items',
                                'inaturalist',
                                `${moment(created_at).year()}`,
                            );

                            mkdirp.sync(dirPath);
                            fs.writeFileSync(path.join(dirPath, `${id}.yaml`), doc);
                            console.log('  -->', path.join(dirPath, `${id}.yaml`));
                        } else {
                            console.log(item);
                            console.log('  --> invalid');
                        }
                    }
                }
            }

            if (quota > 0) await sleep(1);
        } while (quota > 0);
    } catch (e) {
        console.log(e.message);
    }

    fs.writeFileSync(indexFilePath, yaml.safeDump(index));

    return quota;
}

async function userUploadPhoto({ observationId, photoUrl, token }) {
    console.log('     Uploading: ', photoUrl);

    const photoResponse = await fetch(photoUrl);

    if (photoResponse.ok) {
        const contentType = photoResponse.headers.get('content-type');
        const contentLength = photoResponse.headers.get('content-length');

        if (!/^image\//.test(contentType)) {
            console.error('Wrong type', contentType);
        } else if (contentLength > 1000000) {
            console.error('Too large', contentLength);
        } else {
            const buffer = await photoResponse.buffer();

            if (buffer) {
                const form = new FormData();

                form.append('observation_photo[observation_id]', observationId);

                form.append('file', buffer, {
                    contentType,
                    name: 'file',
                    filename: path.basename(new URL(photoUrl).pathname),
                });

                const response = await fetch(new URL('/v1/observation_photos', apiHost).href, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'User-Agent': userAgent,
                        ...form.getHeaders(),
                    },
                    body: form,
                });

                await throwErrorIfTooManyRequests(response);

                return response.status;
            }
        }
    }

    return null;
}

function loadItem({ username, itemsDir, filePath }) {
    const item = yaml.safeLoad(fs.readFileSync(path.join(itemsDir, filePath)));

    const url = new URL('/item', appHost);
    url.search = new URLSearchParams({
        i: `./${path.join(username, 'items', filePath)}`,
    });
    // console.log(' -->', url.href);

    const body = {
        observation: _clean({
            species_guess:
                (item.id && ((typeof item.id[0] === 'string' && item.id[0]) || item.id[0].name)) ||
                null,
            observed_on_string: moment(item.datetime).toISOString(true),
            // time_zone: as above?
            description: [
                item.description,
                item.photos && item.photos.length !== 0
                    ? `*[Full size photo(s) available: [NatureShare.org](${url.href})]*`
                    : null,
            ]
                .filter(Boolean)
                .join('\n\n'),
            tag_list: item.tags && item.tags.join(','),
            latitude: item.latitude,
            longitude: item.longitude,
            observation_field_values_attributes: [
                {
                    observation_field_id: 11952, // NatureShare URL
                    value: url.href,
                },
            ],
            // id_please: false,
        }),
    };
    // console.log(body);

    return {
        item,
        url,
        body,
    };
}

async function userUploadObservationItem({ itemsDir, filePath, username, userId, token }) {
    const { item, body } = loadItem({ username, itemsDir, filePath });

    if (item.photos && item.photos.length !== 0) {
        const response = await fetch(new URL('/v1/observations', apiHost).href, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': userAgent,
                'Content-Type': 'application/json',
            },
            method: 'post',
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const observation = await response.json();
            console.log('     Observation id:', observation.id); // or use uuid?

            if (item.photos) {
                for (const { thumbnail_url: photoUrl } of item.photos) {
                    if (photoUrl) {
                        console.log(
                            await userUploadPhoto({
                                userId,
                                token,
                                observationId: observation.id,
                                photoUrl,
                            }),
                        );
                    }
                }
            }

            return [observation.id, item.updated_at];
        }

        await throwErrorIfTooManyRequests(response);
        return false;
    }

    return null;
}

async function userUpdateObservationItem({
    observationId,
    updatedAt,
    itemsDir,
    filePath,
    username,
    token,
}) {
    const { item, body } = loadItem({ username, itemsDir, filePath });

    // TODO: https://api.inaturalist.org/v1/docs/#!/Taxa/get_taxa

    if (moment(item.updated_at).isAfter(moment(updatedAt))) {
        console.log('------ UPDATE:', filePath);

        const response = await fetch(new URL(`/v1/observations/${observationId}`, apiHost).href, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': userAgent,
                'Content-Type': 'application/json',
            },
            method: 'PUT',
            body: JSON.stringify({
                _method: 'PUT',
                ignore_photos: 1,
                ...body,
            }),
        });

        await throwErrorIfTooManyRequests(response);
    } else {
        console.log('------ SKIP:', filePath);
    }

    return [observationId, item.updated_at];
}

const isDirectory = (dir, f) => fs.lstatSync(path.join(dir, f)).isDirectory();

async function userUploadObservations({ username, userId, token }) {
    const itemsDir = path.join(process.env.CONTENT_FILE_PATH, username, 'items');

    if (fs.existsSync(itemsDir)) {
        const indexFilePath = path.join(itemsDir, 'inaturalist.yaml');
        const index = fs.existsSync(indexFilePath)
            ? yaml.safeLoad(fs.readFileSync(indexFilePath))
            : {};
        let quota = 1000;
        try {
            for (const dir of glob
                .sync('*', { cwd: itemsDir })
                .filter((f) => f && f !== 'inaturalist' && isDirectory(itemsDir, f))) {
                console.log('--', dir);
                for (const subdir of glob
                    .sync(path.join(dir, '*'), { cwd: itemsDir })
                    .filter((f) => isDirectory(itemsDir, f))
                    .sort()
                    .reverse()) {
                    console.log('----', subdir);
                    if (quota <= 0) break;
                    for (const filePath of glob
                        .sync(path.join(subdir, '*.yaml'), { cwd: itemsDir })
                        .sort()
                        .reverse()) {
                        if (quota <= 0) break;
                        if (index[filePath] === undefined) {
                            console.log('------ POST:', filePath);
                            quota -= 1;
                            index[filePath] = await userUploadObservationItem({
                                itemsDir,
                                filePath,
                                username,
                                userId,
                                token,
                            });
                        } else if (enableUpdates && _isArray(index[filePath])) {
                            const [observationId, updatedAt] = index[filePath];
                            index[filePath] = await userUpdateObservationItem({
                                observationId,
                                updatedAt,
                                itemsDir,
                                filePath,
                                username,
                                userId,
                                token,
                            });
                            if (updatedAt !== index[filePath][1]) {
                                quota -= 1;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log(e.message);
        }

        fs.writeFileSync(indexFilePath, yaml.safeDump(index));
    }
}

export async function userSync({ username, userId, token }) {
    console.log('userId', userId);
    await userImportObservations({ username, userId });
    if (enableUploads) {
        await userUploadObservations({ username, userId, token });
    }
    return true;
}

export default async function main({ username, oauth }) {
    if (oauth && oauth.access_token) {
        const { api_token: token } =
            (await authFetch({
                host: webHost,
                pathname: '/users/api_token',
                token: oauth.access_token,
            })) || {};
        if (token) {
            const user = await apiFetch({ pathname: '/v1/users/me', token });
            if (user && user.results && user.results.length !== 0) {
                await userSync({ username, userId: user.results[0].id, token });
            }
        }
    }
    return true;
}
