/* global process URL */

import path from 'path';
import _orderBy from 'lodash/orderBy.js';
import _round from 'lodash/round.js';
import dotenv from '../../utils/dotenv.js';

dotenv.config();

const appHost = process.env.APP_HOST;
const contentHost = process.env.CONTENT_HOST;

export const userUrl = (userDir) =>
    `${appHost}items?i=${encodeURIComponent(
        new URL(path.join('.', userDir, 'items', 'index.json'), contentHost),
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
        ? ary.map((v) => _round(v, 6))
        : null;
