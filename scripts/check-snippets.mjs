// Use // snippet:shape for declaration-only blocks; reference method signatures are inferred.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = resolve(process.argv[2] ?? root);
const scratch = mkdtempSync(join(tmpdir(), "secret-store-snippets-"));

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "adr" ? [] : markdownFiles(path);
    }
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function write(path, content) {
  writeFileSync(join(scratch, path), content);
}

try {
  const blocks = [];
  for (const file of [
    join(docsRoot, "README.md"),
    ...markdownFiles(join(docsRoot, "docs")),
  ]) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(
      /^[ \t]*```ts[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm,
    )) {
      blocks.push({
        source: `${relative(docsRoot, file)}:${markdown.slice(0, match.index).split("\n").length + 1}`,
        document: relative(docsRoot, file),
        code: match[1].trim(),
        file: `snippet-${blocks.length + 1}.ts`,
      });
    }
  }

  mkdirSync(join(scratch, "node_modules"));
  symlinkSync(root, join(scratch, "node_modules/convex-secret-store"), "dir");
  for (const name of ["convex", "@types"]) {
    symlinkSync(
      join(root, "node_modules", name),
      join(scratch, "node_modules", name),
      "dir",
    );
  }
  mkdirSync(join(scratch, "_generated"));
  write("package.json", JSON.stringify({ type: "module" }));
  write(
    "_generated/server.ts",
    `export {
    queryGeneric as query, internalQueryGeneric as internalQuery,
    mutationGeneric as mutation, internalMutationGeneric as internalMutation,
    actionGeneric as action,
  } from "convex/server";`,
  );
  write(
    "secrets.ts",
    `import { SecretStore } from "convex-secret-store";
    import { components } from "./_generated/api.js";
    export const secrets = new SecretStore(components.secretStore);`,
  );

  const modules = new Map();
  for (const block of blocks) {
    const name = block.code.match(/^\/\/ convex\/(\w+)\.ts/m)?.[1];
    if (name) {
      modules.set(name, [
        ...(modules.get(name) ?? []),
        `typeof import("../${block.file.replace(/\.ts$/, ".js")}")`,
      ]);
    }
  }
  write(
    "_generated/api.ts",
    `import type { ApiFromModules } from "convex/server";
    import type { ComponentApi } from "convex-secret-store/_generated/component.js";
    export declare const components: { secretStore: ComponentApi };
    export declare const internal: ApiFromModules<{
      ${Array.from(modules, ([name, types]) => `${name}: ${types.join(" & ")}`).join(";\n")}
    }>;`,
  );

  const shapeImports = `import type {
    RunMutationCtx, RunQueryCtx, PaginationOptions, SecretId, SecretStoreErrorCode,
  } from "convex-secret-store";
    import { SecretStore as ActualSecretStore, isSecretStoreError as actualErrorGuard } from "convex-secret-store";
    import type { ComponentApi } from "convex-secret-store/_generated/component.js";
    import type { ConvexError } from "convex/values";`;

  // This guide is one sequential example, with later blocks using earlier values.
  const envelope = blocks.filter(
    (block) => block.document === "docs/guides/outside-convex.md",
  );
  for (const block of blocks) {
    let code = block.code;
    const method = code.match(/^(\w+)\(\s*ctx:/)?.[1];
    if (code.startsWith("class ")) {
      code = `${shapeImports}\ndeclare ${code}\nconst constructor: typeof SecretStore = ActualSecretStore;`;
    } else if (method) {
      code = `${shapeImports}\ninterface Shape<
        Namespace extends string = string,
        Metadata extends Record<string, unknown> = Record<string, unknown>
      > { ${code} }
      declare const documented: Shape;
      declare const actual: ActualSecretStore;
      const fromPackage: Shape = actual;
      const toPackage: Pick<ActualSecretStore, "${method}"> = documented;`;
    } else if (code.startsWith("isSecretStoreError(")) {
      code = `${shapeImports}\ndeclare function ${code}\nconst guard: typeof actualErrorGuard = isSecretStoreError;`;
    } else if (code.startsWith("// snippet:shape")) {
      code = `${shapeImports}\ndeclare namespace Shape { ${code}\n}`;
    } else if (envelope.includes(block)) {
      code =
        block === envelope[0]
          ? envelope.map((part) => part.code).join("\n")
          : "";
    } else if (/(?:^|\n)(?:await |try\s*\{)/.test(code)) {
      code = `import { secrets } from "./secrets.js";
        import type { RunMutationCtx } from "convex-secret-store";
        declare const ctx: RunMutationCtx;
        declare const value: string;
        ${code}`;
    }
    write(block.file, `// ${block.source}\n${code}\nexport {};\n`);
  }

  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ["ESNext", "DOM"],
        types: ["node"],
      },
      include: ["**/*.ts"],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--project",
      scratch,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    for (const block of blocks) {
      process.stdout.write(`${block.file}: ${block.source}\n`);
    }
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0)
    process.stdout.write(`Checked ${blocks.length} TypeScript snippets.\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
