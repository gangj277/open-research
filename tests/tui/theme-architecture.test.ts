import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const themeManagedFiles = [
  "src/tui/app.tsx",
  "src/tui/components.tsx",
  "src/tui/config-screen.tsx",
  "src/tui/session-picker.tsx",
  "src/tui/text-input.tsx",
];

const disallowedChalkColors = new Set([
  "black",
  "blue",
  "blueBright",
  "cyan",
  "gray",
  "grey",
  "green",
  "magenta",
  "red",
  "white",
  "yellow",
]);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseTsx(relativePath: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function getLineNumber(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function getTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText();
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrapExpression(expression.expression) : expression;
}

function getReturnedRootTagName(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  const unwrapped = unwrapExpression(expression);
  if (ts.isJsxElement(unwrapped)) return getTagName(unwrapped.openingElement.tagName);
  if (ts.isJsxSelfClosingElement(unwrapped)) return getTagName(unwrapped.tagName);
  if (ts.isJsxFragment(unwrapped)) return "Fragment";
  return null;
}

function collectAppReturnRoots(): Array<{ line: number; tagName: string | null }> {
  const sourceFile = parseTsx("src/tui/app.tsx");
  const appFunction = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "App",
  );

  if (!appFunction?.body) {
    throw new Error("Could not find App function body.");
  }

  const returns: Array<{ line: number; tagName: string | null }> = [];

  const visit = (node: ts.Node) => {
    if (node !== appFunction.body && ts.isFunctionLike(node)) {
      return;
    }

    if (ts.isReturnStatement(node)) {
      returns.push({
        line: getLineNumber(sourceFile, node.getStart(sourceFile)),
        tagName: getReturnedRootTagName(node.expression),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(appFunction.body);
  return returns;
}

function collectColorValueLiterals(initializer: ts.JsxAttribute["initializer"]): string[] {
  if (!initializer) return [];
  if (ts.isStringLiteral(initializer)) return [initializer.text];
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return [];

  const visit = (expression: ts.Expression): string[] => {
    const current = unwrapExpression(expression);

    if (ts.isStringLiteralLike(current)) {
      return [current.text];
    }

    if (ts.isConditionalExpression(current)) {
      return [
        ...visit(current.whenTrue),
        ...visit(current.whenFalse),
      ];
    }

    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return [...visit(current.left), ...visit(current.right)];
    }

    return [];
  };

  return visit(initializer.expression);
}

function getPropertyAccessChain(node: ts.PropertyAccessExpression): string[] {
  const chain: string[] = [];
  let current: ts.Expression = node;

  while (ts.isPropertyAccessExpression(current)) {
    chain.unshift(current.name.text);
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    chain.unshift(current.text);
  }

  return chain;
}

function collectHardcodedColorViolations(relativePath: string): string[] {
  const sourceFile = parseTsx(relativePath);
  const violations: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      (node.name.text === "color" || node.name.text === "borderColor")
    ) {
      const stringLiterals = collectColorValueLiterals(node.initializer);
      for (const value of stringLiterals) {
        violations.push(
          `${relativePath}:${getLineNumber(sourceFile, node.getStart(sourceFile))} hardcoded ${node.name.text}="${value}"`,
        );
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const chain = getPropertyAccessChain(node);
      if (
        chain[0] === "chalk" &&
        !chain.includes("hex") &&
        chain.slice(1).some((part) => disallowedChalkColors.has(part))
      ) {
        violations.push(
          `${relativePath}:${getLineNumber(sourceFile, node.getStart(sourceFile))} hardcoded chalk color "${chain.join(".")}"`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

describe("theme architecture", () => {
  test("wraps every App render path in ThemeProvider", () => {
    const returns = collectAppReturnRoots();
    expect(returns.length).toBeGreaterThan(0);
    expect(
      returns.filter((entry) => entry.tagName !== "ThemeProvider"),
      returns
        .map((entry) => `line ${entry.line}: ${entry.tagName ?? "non-JSX return"}`)
        .join("\n"),
    ).toEqual([]);
  });

  test("keeps TUI theme colors centralized in the theme layer", () => {
    const violations = themeManagedFiles.flatMap((relativePath) =>
      collectHardcodedColorViolations(relativePath),
    );

    expect(
      violations,
      violations.length > 0 ? violations.join("\n") : "no hardcoded theme colors found",
    ).toEqual([]);
  });
});
