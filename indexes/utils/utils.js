/* global process URL */

import dotenv from 'dotenv';
import path from 'path';
import _orderBy from 'lodash/orderBy.js';

dotenv.config();

const appHost = process.env.APP_HOST || 'https://natureshare.org.au/';
const contentHost = process.env.CONTENT_HOST || 'https://files.natureshare.org.au/';

export const userUrl = (userDir) =>
    `${appHost}items?i=${encodeURIComponent(
        new URL(path.join('.', userDir, '_index', 'items', 'index.json'), contentHost),
    )}`;

export const dirStr = (i) => i.toLowerCase().replace(/\s/g, '_');

export const sortFeedItems = (items) =>
    _orderBy(
        items,
        [
            '_meta.featured',
            'date_published',
            'date_modified',
            '_meta.itemCount',
            '_meta.imageCount',
            '_meta.videoCount',
            '_meta.audioCount',
        ],
        ['asc', 'desc', 'desc', 'desc', 'desc', 'desc', 'desc'],
    );

export const coord = (ary) =>
    ary.reduce((acc, val) => acc && Boolean(parseFloat(val)), true)
        ? ary.map((v) => Math.round(parseFloat(v) * 1000) / 1000)
        : null;
