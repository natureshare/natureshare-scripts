/* global process URL URLSearchParams */
/* eslint-disable camelcase */

import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import mkdirp from 'mkdirp';
import moment from 'moment';
import yaml from 'js-yaml';
import dotenv from '../../utils/dotenv.js';
import { _clean, itemIsValid, getValidLocation } from './utils.js';

dotenv.config();

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

async function userSync({ username, userId, token }) {
    console.log('userId', userId);
    await userImportObservations({ username, userId, token });
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
