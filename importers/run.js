/* global process URL */

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import jose from 'node-jose';
import flickr from './handler/flickr.js';

dotenv.config();

// https://www.npmjs.com/package/node-fetch

const handlers = {
    flickr,
};

fetch(new URL('/users', process.env.API_URL).href, {
    headers: {
        Authorization: `API_TOKEN ${process.env.API_TOKEN}`,
    },
})
    .then((response) => {
        if (response.ok) {
            response
                .json()
                .then((usersJWE) => {
                    jose.JWK.asKey(process.env.DATA_PRIVATE_KEY).then((privateKey) => {
                        jose.JWE.createDecrypt(privateKey)
                            .decrypt(usersJWE)
                            .then((usersJson) => {
                                const users = JSON.parse(usersJson.plaintext.toString());
                                console.log(users.length, 'users');
                                users.forEach((user) => {
                                    if (user.data.oauth) {
                                        console.log(user.name);
                                        Object.keys(user.data.oauth).forEach((provider) => {
                                            if (provider in handlers) {
                                                console.log('  ', provider);

                                                jose.JWE.createDecrypt(privateKey)
                                                    .decrypt(user.data.oauth[provider])
                                                    .then((oauthJson) => {
                                                        const oauth = JSON.parse(
                                                            oauthJson.plaintext.toString(),
                                                        );
                                                        // console.log(oauth);
                                                        handlers[provider]({
                                                            username: user.name,
                                                            oAuthKey: process.env.OAUTH_FLICKR_KEY,
                                                            oAuthSecret:
                                                                process.env.OAUTH_FLICKR_SECRET,
                                                            apiToken: oauth.oauth_token,
                                                            apiSecret: oauth.oauth_token_secret,
                                                            userId: oauth.user_nsid,
                                                        });
                                                    });
                                            }
                                        });
                                    }
                                });
                            });
                    });
                })
                .catch(console.error);
        }
    })
    .catch(console.error);
