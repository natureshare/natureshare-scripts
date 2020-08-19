/* global process */

import dotenv from 'dotenv';

function config() {
    dotenv.config();

    if (process.env.SECRETS_JSON)
        process.env = { ...process.env, ...JSON.parse(process.env.SECRETS_JSON) };
}

export default { config };
