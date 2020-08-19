import importer from './importer.js';

async function test() {
    await importer('reilly', 'all');
}

test().then(console.log).catch(console.error);
