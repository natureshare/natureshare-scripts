import _omitBy from 'lodash/omitBy.js';

export default (obj) => _omitBy(obj, (i) => i === undefined || i === null || i === '');
