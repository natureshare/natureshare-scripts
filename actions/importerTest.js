import importer from './importer.js';

async function test() {
    return importer('reilly', 'all');
}

test().then(console.log).catch(console.error);
