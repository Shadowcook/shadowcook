import { Ajv } from 'ajv';
import formats from 'ajv-formats';

export function createSchemaValidator(): Ajv {
  const validator: Ajv = new Ajv({
    allErrors: false,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
  });
  formats.default(validator);
  return validator;
}
