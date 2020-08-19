/* eslint-disable import/prefer-default-export */

export function assert(obj) {
    Object.keys(obj).forEach((key) => {
        if (!obj[key]) {
            throw new Error(key);
        }
    });
}
