import {
  type ASTVisitor,
  type FragmentDefinitionNode,
  GraphQLError,
  Kind,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/** Depth of the deepest field path of every operation (fragments expanded; `__typename` and introspection excluded). */
export function depthLimitRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);

    const depthOf = (set: SelectionSetNode, depth: number, visited: Set<string>): number => {
      let max = depth;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          if (sel.name.value.startsWith('__')) continue;
          const here = depth + 1;
          max = Math.max(max, sel.selectionSet ? depthOf(sel.selectionSet, here, visited) : here);
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          max = Math.max(max, depthOf(sel.selectionSet, depth, visited));
        } else {
          const name = sel.name.value;
          const fragment = fragments.get(name);
          if (fragment && !visited.has(name)) max = Math.max(max, depthOf(fragment.selectionSet, depth, new Set([...visited, name])));
        }
      }
      return max;
    };

    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, 0, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${depth} exceeds the maximum of ${maxDepth}`, { nodes: [node], extensions: { code: 'QUERY_TOO_DEEP', maxDepth, depth } }),
          );
        }
      },
    };
  };
}

/** Static cost: every field costs 1; a list field multiplies its children by `first`/`limit` (default 10, max 100). */
export function complexityLimitRule(maxComplexity: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);

    const multiplierOf = (args: readonly { name: { value: string }; value: { kind: string; value?: string } }[] | undefined): number => {
      const arg = args?.find((a) => a.name.value === 'first' || a.name.value === 'limit');
      if (arg && arg.value.kind === Kind.INT) return Math.min(Math.max(Number(arg.value.value), 1), 100);
      return 1;
    };

    const cost = (set: SelectionSetNode, visited: Set<string>): number => {
      let total = 0;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          if (sel.name.value.startsWith('__')) continue;
          const children = sel.selectionSet ? cost(sel.selectionSet, visited) : 0;
          const multiplier = multiplierOf(sel.arguments as never);
          total += 1 + (children === 0 ? 0 : children * multiplier);
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          total += cost(sel.selectionSet, visited);
        } else {
          const fragment = fragments.get(sel.name.value);
          if (fragment && !visited.has(sel.name.value)) total += cost(fragment.selectionSet, new Set([...visited, sel.name.value]));
        }
      }
      return total;
    };

    return {
      OperationDefinition(node) {
        const total = cost(node.selectionSet, new Set());
        if (total > maxComplexity) {
          context.reportError(
            new GraphQLError(`Query complexity ${total} exceeds the maximum of ${maxComplexity}`, {
              nodes: [node],
              extensions: { code: 'QUERY_TOO_COMPLEX', maxComplexity, complexity: total },
            }),
          );
        }
      },
    };
  };
}
