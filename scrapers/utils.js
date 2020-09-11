import yaml from 'js-yaml';
import _snakeCase from 'lodash/snakeCase.js';
import path from 'path';
import mkdirp from 'mkdirp';
import fs from 'fs';
import { itemIsValid } from '../actions/importers/utils.js';

export function somethingElse() {}

export function writeItemFile({ dirPath, id, item }) {
    if (item && item.photos && item.photos.length === 0) {
        console.log(id, '--> No Photos!');
    } else if (item && itemIsValid(item)) {
        mkdirp.sync(dirPath);
        const fileName = _snakeCase(
            [item.id[0].name, item.id[0].common, id].filter(Boolean).join(' '),
        );
        const doc = yaml.safeDump(item, {
            lineWidth: 1000,
            noRefs: true,
        });
        // console.log(doc);
        fs.writeFileSync(path.join(dirPath, `${fileName}.yaml`), doc);
        // console.log(id, '-->', path.join(dirPath, `${fileName}.yaml`));
        return 'Done.';
    } else {
        // console.log(JSON.stringify(item, null, 4));
        console.log(id, '--> Invalid!');
    }
    return 'Done';
}
