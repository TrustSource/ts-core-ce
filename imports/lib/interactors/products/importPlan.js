// Validates a products import file (format TrustSourceProducts, version 1) as a
// whole before anything is written, and returns the rows to create with their
// parent. Pure: the caller supplies the identifiers that already exist.

export const MAX_IMPORT_PRODUCTS = 1000;

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function checkProducts(products, existing, errors) {
  const seen = new Set();
  products.forEach(function (product, index) {
    const row = `Product ${index + 1}`;
    if (!product || typeof product !== 'object') {
      errors.push(`${row} is not an object`);
      return;
    }
    if (!isText(product.identifier)) {
      errors.push(`${row} has no identifier`);
      return;
    }
    if (!isText(product.name)) {
      errors.push(`${row} (${product.identifier}) has no name`);
    }
    if (product.type !== undefined && typeof product.type !== 'string') {
      errors.push(`${row} (${product.identifier}) has an invalid type`);
    }
    if (seen.has(product.identifier)) {
      errors.push(`Identifier ${product.identifier} appears more than once`);
    } else if (existing.has(product.identifier)) {
      errors.push(`Product with same identifier already exists: ${product.identifier}`);
    }
    seen.add(product.identifier);
  });
  return seen;
}

// identifier -> parent identifier, from the relations of the file.
function parentsFromRelations(relations, inFile, existing, errors) {
  const parentOf = new Map();
  relations.forEach(function (relation, index) {
    const row = `Relation ${index + 1}`;
    if (!relation || !isText(relation.identifier) || !Array.isArray(relation.contains)) {
      errors.push(`${row} needs an identifier and a contains list`);
      return;
    }
    if (!inFile.has(relation.identifier) && !existing.has(relation.identifier)) {
      errors.push(`${row}: parent ${relation.identifier} is neither in the file nor an existing product`);
    }
    relation.contains.forEach(function (child) {
      if (!inFile.has(child)) {
        errors.push(`${row}: ${child} is not a product of this file`);
      } else if (parentOf.has(child) && parentOf.get(child) !== relation.identifier) {
        errors.push(`${child} has more than one parent`);
      } else if (child === relation.identifier) {
        errors.push(`${child} contains itself`);
      } else {
        parentOf.set(child, relation.identifier);
      }
    });
  });
  return parentOf;
}

function findCycle(parentOf) {
  for (const start of parentOf.keys()) {
    const path = new Set([start]);
    let current = parentOf.get(start);
    while (current !== undefined) {
      if (path.has(current)) {
        return current;
      }
      path.add(current);
      current = parentOf.get(current);
    }
  }
  return null;
}

/**
 * @param {Object} data            the parsed file
 * @param {Set<String>} existing   identifiers of the company's products
 * @param {String} [parentId]      parent chosen in the dialog for top-level rows
 * @returns {{errors: String[], rows: Object[]}} rows only when there are no errors
 */
export function planProductImport(data, existing, parentId) {
  const errors = [];
  if (!data || data.version !== 1 || !Array.isArray(data.products)) {
    return {errors: ['Unsupported file: expected version 1 with a products list'], rows: []};
  }
  if (data.relations !== undefined && !Array.isArray(data.relations)) {
    return {errors: ['Unsupported file: relations must be a list'], rows: []};
  }
  if (data.products.length === 0) {
    return {errors: ['The file contains no products'], rows: []};
  }
  if (data.products.length > MAX_IMPORT_PRODUCTS) {
    return {errors: [`The file contains ${data.products.length} products; at most ${MAX_IMPORT_PRODUCTS} can be imported at once`], rows: []};
  }
  if (parentId && !existing.has(parentId)) {
    errors.push(`Parent ${parentId} is not an existing product`);
  }
  const inFile = checkProducts(data.products, existing, errors);
  const parentOf = parentsFromRelations(data.relations || [], inFile, existing, errors);
  const cycle = findCycle(parentOf);
  if (cycle !== null) {
    errors.push(`The relations contain a cycle at ${cycle}`);
  }
  if (errors.length) {
    return {errors, rows: []};
  }
  const rows = data.products.map(function (product) {
    return {
      type: product.type,
      identifier: product.identifier,
      name: product.name,
      description: product.description,
      properties: product.properties,
      parentId: parentOf.has(product.identifier) ? parentOf.get(product.identifier) : (parentId || undefined)
    };
  });
  return {errors, rows};
}
