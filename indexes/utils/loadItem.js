/* global process URL */

import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import _uniq from 'lodash/uniq.js';
import _isArray from 'lodash/isArray.js';
import _truncate from 'lodash/truncate.js';
import dotenv from '../../utils/dotenv.js';
import omitNull from './omitNull.js';
import { coord } from './utils.js';

dotenv.config();

const cwd = process.env.CONTENT_FILE_PATH;
const appHost = process.env.APP_HOST || 'https://natureshare.org.au/';
const contentHost = process.env.CONTENT_HOST || 'https://files.natureshare.org.au/';

const mapIdNames = (ary) =>
    _uniq(
        ary
            .map((i) => (typeof i === 'object' ? i.name : i))
            .filter((i) => typeof i === 'string')
            .map((i) => i.trim())
            .filter((i) => i.length !== 0),
    );

export default (userDir, f) => {
    const filePath = path.join(userDir, 'items', f);

    const {
        datetime,
        created_at: createdAt,
        updated_at: updatedAt,
        id: identifications,
        description,
        photos,
        videos,
        audio,
        latitude,
        longitude,
        tags,
        collections,
    } = yaml.safeLoad(fs.readFileSync(path.join(cwd, filePath)));

    const id = new URL(path.join('.', filePath), contentHost).href;

    const url = `${appHost}item?i=${encodeURIComponent(id)}`;

    const idNames = _isArray(identifications) ? _uniq(mapIdNames(identifications)).sort() : null;

    const title = _truncate(
        (_isArray(idNames) &&
            ((idNames.length > 2 && `${idNames.length} ids`) || idNames.join(', '))) ||
            'Unidentified',
        { length: 64 },
    );

    const image =
        photos && photos.length !== 0
            ? (photos.filter((i) => i.primary)[0] || photos[0]).thumbnail_url
            : null;

    const item = omitNull({
        id,
        url,
        title,
        content_text: description || '-',
        image,
        date_published: createdAt,
        date_modified: updatedAt,
        tags: [
            ...(_isArray(idNames) ? idNames.map((i) => `id~${i}`) : ['id~Unidentified']),
            ...(_isArray(tags) && tags.length !== 0
                ? _uniq(tags)
                      .sort()
                      .map((i) => `tag~${i}`)
                : []),
        ],
        _geo: {
            coordinates: coord([longitude, latitude]),
        },
        _meta: omitNull({
            date: (datetime && datetime.split('T')[0]) || null,
            imageCount: (photos && photos.length) || null,
            videoCount: (videos && videos.length) || null,
            audioCount: (audio && audio.length) || null,
            // idCount: _isArray(idNames) ? _uniq(identifications).length : null,
            // tagCount: _isArray(tags) ? tags.length : null,
        }),
    });

    return { item, collections };
};
