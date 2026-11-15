import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageName, validateMessage } from '../../src/shared/contracts';

const example = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'examples', `${name}.json`), 'utf8'));
const NAMES: MessageName[] = ['hello-v1', 'heartbeat-v1', 'outbox-v1', 'snapshot-v1', 'lease-v1', 'ack-v1'];

describe('runtime contract validation', () => {
  it.each(NAMES)('accepts the %s example', (name) => {
    expect(validateMessage(name, example(name))).toBeNull();
  });

  it('describes what is wrong with an invalid message', () => {
    const hello = example('hello-v1');
    delete hello.boot_id;
    hello.snapshot_version = -1;
    const problem = validateMessage('hello-v1', hello);
    expect(problem).toMatch(/boot_id/);
    expect(problem).toMatch(/snapshot_version/);
    expect(validateMessage('heartbeat-v1', example('hello-v1'))).not.toBeNull();
    expect(validateMessage('lease-v1', 'text')).not.toBeNull();
  });
});
