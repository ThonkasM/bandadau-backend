import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from 'graphql';

const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stringScalar = (name: string, description: string, test: (s: string) => boolean, serializeValue?: (v: unknown) => unknown) =>
  new GraphQLScalarType<string, string>({
    name,
    description,
    serialize(value) {
      const v = serializeValue ? serializeValue(value) : value;
      if (typeof v !== 'string' || !test(v)) throw new GraphQLError(`${name} cannot represent value: ${String(value)}`);
      return v;
    },
    parseValue(value) {
      if (typeof value !== 'string' || !test(value)) throw new GraphQLError(`${name} must be a valid string value`);
      return value;
    },
    parseLiteral(ast: ValueNode) {
      if (ast.kind !== Kind.STRING || !test(ast.value)) throw new GraphQLError(`${name} must be a valid string value`);
      return ast.value;
    },
  });

const literalToJson = (ast: ValueNode, variables?: Record<string, unknown> | null): unknown => {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return ast.values.map((v) => literalToJson(v, variables));
    case Kind.OBJECT:
      return Object.fromEntries(ast.fields.map((f) => [f.name.value, literalToJson(f.value, variables)]));
    case Kind.VARIABLE:
      return variables?.[ast.name.value];
    default:
      return undefined;
  }
};

export const scalarResolvers = {
  DateTime: stringScalar('DateTime', 'ISO-8601 date-time in UTC', (s) => isoDateTime.test(s), (v) => (v instanceof Date ? v.toISOString() : v)),
  Date: stringScalar('Date', 'ISO-8601 date', (s) => isoDate.test(s)),
  UUID: stringScalar('UUID', 'UUID', (s) => uuid.test(s)),
  JSON: new GraphQLScalarType({
    name: 'JSON',
    description: 'Arbitrary JSON value',
    serialize: (v) => v,
    parseValue: (v) => v,
    parseLiteral: (ast, variables) => literalToJson(ast, variables),
  }),
  Long: new GraphQLScalarType<number, number>({
    name: 'Long',
    description: '64-bit integer as a JSON number',
    serialize(value) {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new GraphQLError(`Long cannot represent value: ${String(value)}`);
      return n;
    },
    parseValue(value) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new GraphQLError('Long must be a safe integer');
      return value;
    },
    parseLiteral(ast) {
      if (ast.kind !== Kind.INT) throw new GraphQLError('Long must be an integer literal');
      return Number(ast.value);
    },
  }),
};
