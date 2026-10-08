// Flat ESLint preset. Spread this array into a package's ESLint config; use
// createPreset({ sourceFiles, mathFiles, hashFiles }) from a workspace root.
const bannedMath = new Set([
  'random', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'pow', 'exp', 'log', 'hypot', 'round',
]);
const integerMath = new Set(['floor', 'trunc', 'imul']);
const bannedGlobals = [
  'Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'console', 'Intl',
];
function propertyName(node) {
  return node.computed ? node.property.value : node.property.name;
}
function objectName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.object.name === 'globalThis') return propertyName(node);
  return undefined;
}
const plugin = { rules: {
  operations: {
    meta: { type: 'problem', schema: [{ type: 'object', properties: {
      integerMath: { type: 'boolean' }, hash: { type: 'boolean' },
    }, additionalProperties: false }], messages: { forbidden: '{{operation}} is forbidden in deterministic source.' } },
    create(context) {
      const options = context.options[0] ?? {};
      function check(node, object, property) {
        if ((object === 'Math' && (bannedMath.has(property) || (!options.integerMath && integerMath.has(property)))) ||
            (options.hash && object === 'JSON' && property === 'stringify')) {
          context.report({ node, messageId: 'forbidden', data: { operation: `${object}.${property}` } });
        }
      }
      return {
        MemberExpression(node) { check(node, objectName(node.object), propertyName(node)); },
        VariableDeclarator(node) {
          if (node.id.type !== 'ObjectPattern' || !node.init) return;
          for (const property of node.id.properties) {
            if (property.type === 'Property') check(property, objectName(node.init), property.key.name ?? property.key.value);
          }
        },
        Literal(node) {
          if (typeof node.value === 'number' && (node.raw.includes('.') || !Number.isInteger(node.value))) {
            context.report({ node, messageId: 'forbidden', data: { operation: 'Float literal' } });
          }
        },
        ForInStatement(node) { context.report({ node, messageId: 'forbidden', data: { operation: 'for…in' } }); },
        CallExpression(node) {
          if (node.callee.type === 'MemberExpression' && propertyName(node.callee) === 'sort' && node.arguments.length === 0) {
            context.report({ node, messageId: 'forbidden', data: { operation: 'sort without a comparator' } });
          }
        },
      };
    },
  },
  'content-types-only': {
    meta: { type: 'problem', schema: [], messages: { forbidden: 'Sim may import only relative modules and content types.' } },
    create(context) {
      function check(node) {
        const source = node.source?.value;
        if (typeof source !== 'string' || source.startsWith('./') || source.startsWith('../')) return;
        const typeOnly = node.importKind === 'type' || node.exportKind === 'type' ||
          (node.specifiers?.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type'));
        if (source !== '@node-arena/content' || !typeOnly) context.report({ node, messageId: 'forbidden' });
      }
      return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check,
        ImportExpression(node) {
          if (node.source.type !== 'Literal' || !/^\.\.?\//.test(node.source.value)) context.report({ node, messageId: 'forbidden' });
        },
      };
    },
  },
} };
function createPreset({ sourceFiles = ['src/**/*.ts'], mathFiles = ['src/math.ts'], hashFiles = ['src/hash.ts', 'src/hash/**/*.ts'] } = {}) {
  return [
    { files: sourceFiles, plugins: { determinism: plugin }, rules: {
      'determinism/operations': 'error',
      'no-restricted-globals': ['error', { globals: bannedGlobals, checkGlobalObject: true, globalObjects: ['globalThis'] }],
    } },
    { files: mathFiles, rules: { 'determinism/operations': ['error', { integerMath: true }] } },
    { files: hashFiles, rules: { 'determinism/operations': ['error', { hash: true }] } },
  ];
}
module.exports = createPreset();
module.exports.createPreset = createPreset;
module.exports.contentTypesOnly = { 'determinism/content-types-only': 'error' };
