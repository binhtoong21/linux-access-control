import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// contracts/ is the single source of truth for the MQTT message formats (contracts/README.md). The server validates what it
// receives against the same schema files the edge tests use. CONTRACTS_DIR overrides the location for packaged installs.
export type MessageName = 'hello-v1' | 'heartbeat-v1' | 'outbox-v1' | 'snapshot-v1' | 'lease-v1' | 'ack-v1';

const contractsDir = (): string => process.env.CONTRACTS_DIR || path.resolve(__dirname, '..', '..', '..', 'contracts');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map<MessageName, ValidateFunction>();

function validator(name: MessageName): ValidateFunction {
  let validate = validators.get(name);
  if (!validate) {
    const schema = JSON.parse(readFileSync(path.join(contractsDir(), 'schemas', `${name}.schema.json`), 'utf8')) as object;
    validate = ajv.compile(schema);
    validators.set(name, validate);
  }
  return validate;
}

/** null when `value` is a valid message of that contract, otherwise a short description of what is wrong. */
export function validateMessage(name: MessageName, value: unknown): string | null {
  const validate = validator(name);
  return validate(value) ? null : ajv.errorsText(validate.errors);
}
