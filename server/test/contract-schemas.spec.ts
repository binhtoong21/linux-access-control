// contracts/examples must validate against contracts/schemas (same check runs in edge/tests).
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '..', '..', 'contracts');
const load = (p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const NAMES = ['hello-v1', 'heartbeat-v1', 'outbox-v1', 'snapshot-v1', 'lease-v1', 'ack-v1'];

describe('message contracts', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  it.each(NAMES)('%s example matches its schema', (name) => {
    const validate = ajv.compile(load(`schemas/${name}.schema.json`));
    expect(validate(load(`examples/${name}.json`))).toBe(true);
  });

  it('rejects an unknown outcome', () => {
    const validate = ajv.getSchema('outbox-v1')!;
    const batch = load('examples/outbox-v1.json');
    batch.records[0].payload.outcome = 'maybe';
    expect(validate(batch)).toBe(false);
  });
});
