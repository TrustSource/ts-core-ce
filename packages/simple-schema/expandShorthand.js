import MongoObject from 'mongo-object';

/**
 * Clones a schema object, expanding shorthand as it does it.
 */
function expandShorthand(schema) {
  const schemaClone = {};

  Object.keys(schema).forEach((key) => {
    const definition = schema[key];
    // CASE 1: Not shorthand. Just clone (with legacy array type support)
    if (MongoObject.isBasicObject(definition)) {
      schemaClone[key] = { ...definition };
      // Support legacy `type: [X]` shorthand inside definition objects
      if (Array.isArray(definition.type)) {
        if (definition.type.length !== 1) {
          throw new Error(`Array shorthand requires exactly one type element (${key})`);
        }
        const itemType = definition.type[0];
        schemaClone[key].type = Array;
        const itemKey = `${key}.$`;
        if (!schema[itemKey]) {
          if (itemType instanceof RegExp) {
            schemaClone[itemKey] = { type: String, regEx: itemType };
          } else {
            schemaClone[itemKey] = { type: itemType };
          }
          // `blackbox` describes the array *items*, not the array itself, so it has
          // to travel with the generated item definition. Without this, a legacy
          // `{type: [Object], blackbox: true}` field ends up with a plain
          // non-blackbox `key.$`, allowsKey() rejects every `key.$.<prop>`, and
          // clean({filter: true}) strips each item down to `{}`, which then gets
          // dropped as an empty object, silently emptying the whole array.
          if (definition.blackbox === true) {
            schemaClone[itemKey].blackbox = true;
          }
        }
      }
      return;
    }

    // CASE 2: The definition is an array of some type
    if (Array.isArray(definition)) {
      if (Array.isArray(definition[0])) {
        throw new Error(`Array shorthand may only be used to one level of depth (${key})`);
      }
      const type = definition[0];
      schemaClone[key] = { type: Array };

      // Also add the item key definition
      const itemKey = `${key}.$`;
      if (schema[itemKey]) {
        throw new Error(`Array shorthand used for ${key} field but ${key}.$ key is already in the schema`);
      }

      if (type instanceof RegExp) {
        schemaClone[itemKey] = { type: String, regEx: type };
      } else {
        schemaClone[itemKey] = { type };
      }
      return;
    }

    // CASE 3: The definition is a regular expression
    if (definition instanceof RegExp) {
      schemaClone[key] = {
        type: String,
        regEx: definition,
      };
      return;
    }

    // CASE 4: The definition is something, a type
    schemaClone[key] = { type: definition };
  });

  return schemaClone;
}

export default expandShorthand;
