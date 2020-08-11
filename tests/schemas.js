import fs from 'fs';
import yaml from 'js-yaml';
import glob from 'glob';
import jsonschema from 'jsonschema';

const validator = new jsonschema.Validator();

const tagSchema = yaml.safeLoad(fs.readFileSync('./schemas/item.yaml'));
// const geoJsonSchema = JSON.parse(FS.readFileSync('./schemas/geo.json'));

glob.sync('./tests/examples/items/*.yaml').forEach((filePath) => {
    console.log();
    console.log('--- #', filePath);
    const content = yaml.safeLoad(fs.readFileSync(filePath));
    console.log(
        yaml.safeDump(content, {
            lineWidth: 1000,
            noRefs: true,
        }),
    );
    const result = validator.validate(content, tagSchema, {
        throwError: false,
    });
    console.log(result.errors.length === 0 ? '# OK' : '# FAIL');
});

console.log();
