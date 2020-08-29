/* global process URL */

import fetch from 'node-fetch';
import jose from 'node-jose';
import dotenv from '../utils/dotenv.js';
import { assert } from './utils.js';
import flickr from './importers/flickr.js';
import dropbox from './importers/dropbox.js';
// import inaturalist from './importers/inaturalist.js';
// import google from './importers/google.js';

dotenv.config();

const apiHost = process.env.API_HOST;
const apiToken = process.env.API_TOKEN;
const apiDataPrivateKey = process.env.API_DATA_PRIVATE_KEY;

assert({ apiHost, apiToken, apiDataPrivateKey });

async function decrypt(jwe) {
    const privateKey = await jose.JWK.asKey(apiDataPrivateKey);
    const obj = await jose.JWE.createDecrypt(privateKey).decrypt(jwe);
    return JSON.parse(obj.plaintext.toString());
}

const importers = {
    flickr,
    dropbox,
    // inaturalist,
    // google,
};

export default async function run(username, provider) {
    console.log('username:', username, ', provider:', provider);

    const response = await fetch(new URL(`/users${username ? `/${username}` : ''}`, apiHost).href, {
        headers: {
            Authorization: `API_TOKEN ${apiToken}`,
        },
    });

    if (response.ok) {
        const users = await decrypt(await response.json());
        console.log(users.length, 'users');
        for (const user of users) {
            if (user.data.oauth) {
                console.log(user.name);
                if (provider === 'all') {
                    for (const p in user.data.oauth) {
                        if (p in importers) {
                            console.log('===', p, '===');
                            await importers[p]({
                                username: user.name,
                                oauth: await decrypt(user.data.oauth[p]),
                            });
                        }
                    }
                } else if (user.data.oauth[provider] && importers[provider]) {
                    console.log(' ', provider);
                    await importers[provider]({
                        username: user.name,
                        oauth: await decrypt(user.data.oauth[provider]),
                    });
                }
            }
        }
    }

    return 'Done.';
}
