// https://www.inaturalist.org/oauth/applications/492
// https://www.inaturalist.org/pages/api+reference#post-observations
// https://www.inaturalist.org/pages/api+reference#post-observation_photos
// https://api.inaturalist.org/v1/docs/#!/Observations/post_observations
// https://api.inaturalist.org/v1/docs/#/Observation_Photos
// https://github.com/inaturalist/inaturalist/blob/master/app/controllers/observation_photos_controller.rb

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
import dotenv from '../../utils/dotenv.js';
import { _clean, itemIsValid, getValidLocation } from './utils.js';

dotenv.config();

const appHost = process.env.APP_HOST || 'https://natureshare.org.au/';
const contentHost = process.env.CONTENT_HOST || 'https://files.natureshare.org.au/';

const contentFilePath = process.env.CONTENT_FILE_PATH;

const webHost = 'https://www.inaturalist.org';
const apiHost = 'https://api.inaturalist.org';

async function authFetch({ host, pathname, search, token }) {
    const url = new URL(pathname, host);
    if (search) url.search = new URLSearchParams(search);
    const response = await fetch(url.href, {
        headers: {
            Authorization: `Bearer ${token}`,
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

async function userImportObservations({ username, userId, token }) {
    let quota = 1000;
    let idAbove = null;

    do {
        console.log('idAbove', idAbove, 'quota', quota);

        const data = await apiFetch({
            pathname: '/v1/observations',
            search: {
                user_id: userId,
                // updated_since: todo
                ...(idAbove ? { id_above: idAbove } : {}),
                order_by: 'created_at',
                order: 'desc',
            },
            token,
        });

        idAbove = null;

        if (data.results.length !== 0) {
            quota -= data.results.length;

            for (const {
                id,
                uri,
                time_observed_at,
                private_location,
                place_guess,
                description,
                ofvs,
                tags,
                identifications,
                photos,
                license_code,
                created_at,
                updated_at,
            } of data.results) {
                if (!ofvs || ofvs.filter((f) => f.name === 'NatureShare URL').length === 0) {
                    console.log('    Observation:', id);
                    const item = _clean({
                        id:
                            identifications &&
                            identifications.map((i) => ({
                                name: i.taxon.name,
                                common: i.taxon.preferred_common_name,
                                by: i.user.login,
                            })),
                        datetime: time_observed_at,
                        ...getValidLocation({
                            latitude: private_location.split(',', 2)[0],
                            longitude: private_location.split(',', 2)[1],
                        }),
                        location_name: place_guess,
                        description,
                        tags: [
                            'inaturalist',
                            ...(tags
                                ? tags.map((i) => i.toLowerCase().replace(/[^a-z0-9-_.]/g, ''))
                                : []),
                        ],
                        photos: photos.map((i) => ({
                            source: 'iNaturalist',
                            id: `${i.id}`,
                            width: i.original_dimensions.width,
                            height: i.original_dimensions.height,
                            thumbnail_url: `https://static.inaturalist.org/photos/${i.id}/large.jpg`,
                            original_url: `https://static.inaturalist.org/photos/${i.id}/original.jpg`,
                            license: i.license_code.toUpperCase().replace('-', ' '),
                        })),
                        license: license_code.toUpperCase().replace('-', ' '),
                        created_at,
                        updated_at,
                        source: [
                            {
                                name: 'iNaturalist',
                                href: uri, // `https://www.inaturalist.org/observations/${id}`,
                            },
                        ],
                    });

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
                    } else {
                        console.log(item);
                        console.log(' -> invalid');
                    }
                }
            }

            if (data.results.length === data.per_page) {
                idAbove = data.results[data.results.length - 1];
            }
        }
    } while (idAbove && quota > 0);
}

async function userUploadPhoto({ observationId, photoUrl, token }) {
    console.log('-- Uploading: ', photoUrl);

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
                        ...form.getHeaders(),
                    },
                    body: form,
                });

                if (!response.ok) {
                    console.error(response.status);
                    console.error(await response.text());
                }

                return response.status;
            }
        }
    }

    return null;
}

async function userUploadObservations({ username, userId, token }) {
    console.log(username, userId, token);

    const itemsDir = path.join(process.env.CONTENT_FILE_PATH, username, 'items');

    if (fs.existsSync(itemsDir)) {
        const indexFilePath = path.join(itemsDir, 'inaturalist.yaml');
        const index = fs.existsSync(indexFilePath)
            ? yaml.safeLoad(fs.readFileSync(indexFilePath))
            : {};
        let quota = 10;

        const itemsSubDirs = glob
            .sync('*', { cwd: itemsDir })
            .filter(
                (f) =>
                    f && f !== 'inaturalist' && fs.lstatSync(path.join(itemsDir, f)).isDirectory(),
            );

        for (const subdir of itemsSubDirs) {
            if (quota <= 0) break;
            for (const f of glob.sync(path.join(subdir, '*', '*.yaml'), { cwd: itemsDir })) {
                if (quota <= 0) break;
                if (index[f] === undefined) {
                    console.log(f);
                    quota -= 1;
                    index[f] = null;

                    const item = yaml.safeLoad(fs.readFileSync(path.join(itemsDir, f)));

                    if (
                        (item.photos && item.photos.length !== 0) ||
                        (item.id && item.id.length === 1)
                    ) {
                        const url = new URL('/item', appHost);
                        url.search = new URLSearchParams({
                            i: new URL(path.join('/', username, 'items', f), contentHost).href,
                        });
                        console.log(url.href);

                        const body = {
                            observation: _clean({
                                species_guess:
                                    (item.id &&
                                        ((typeof item.id[0] === 'string' && item.id[0]) ||
                                            item.id[0].name)) ||
                                    null,
                                observed_on_string: moment(item.datetime).toISOString(true),
                                // time_zone: as above?
                                description: item.description,
                                tag_list: item.tags && item.tags.join(','),
                                latitude: item.latitude,
                                longitude: item.longitude,
                                observation_field_values_attributes: [
                                    {
                                        observation_field_id: 11952, // NatureShare URL
                                        value: url.href,
                                    },
                                ],
                            }),
                        };
                        console.log(body);

                        const response = await fetch(new URL('/v1/observations', apiHost).href, {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json',
                            },
                            method: 'post',
                            body: JSON.stringify(body),
                        });

                        if (response.ok) {
                            const observation = await response.json();
                            console.log('Observation id:', observation.id); // or use uuid?
                            index[f] = observation.id;

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
                        } else {
                            index[f] = false;
                            console.error(response.status);
                            console.error(await response.text());
                        }
                    }

                    fs.writeFileSync(indexFilePath, yaml.safeDump(index));
                }
            }
        }
    }
}

export async function userSync({ username, userId, token }) {
    console.log('userId', userId);
    await userImportObservations({ username, userId, token });
    await userUploadObservations({ username, userId, token });
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
