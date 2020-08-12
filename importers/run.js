/* global process URL */

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import jose from 'node-jose';
import flickr from './handler/flickr.js';
import dropbox from './handler/dropbox.js';

dotenv.config();

const apiHost = process.env.API_HOST;
const apiToken = process.env.API_TOKEN;
const apiDataPrivateKey = process.env.API_DATA_PRIVATE_KEY;

const handlers = {
    flickr,
    dropbox,
};

const run = async () => {
    const privateKey = await jose.JWK.asKey(apiDataPrivateKey);

    const response = await fetch(new URL('/users', apiHost).href, {
        headers: {
            Authorization: `API_TOKEN ${apiToken}`,
        },
    });

    if (response.ok) {
        const usersJWE = await response.json();
        const usersJson = await jose.JWE.createDecrypt(privateKey).decrypt(usersJWE);
        const users = JSON.parse(usersJson.plaintext.toString());
        console.log(users.length, 'users');

        for (const user of users) {
            if (user.data.oauth) {
                console.log(user.name);

                for (const provider in user.data.oauth) {
                    if (provider in handlers) {
                        console.log(' ', provider);

                        const oauthJson = await jose.JWE.createDecrypt(privateKey).decrypt(
                            user.data.oauth[provider],
                        );

                        const oauth = JSON.parse(oauthJson.plaintext.toString());

                        // console.log(oauth);

                        await handlers[provider]({
                            username: user.name,
                            oauth,
                        });
                    }
                }
            }
        }
    }

    return 'Done.';
};

run().then(console.log).catch(console.error);
