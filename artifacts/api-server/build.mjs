import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts", migrate: "src/scripts/migrate.ts", seed: "src/scripts/seed.ts", jobs: "src/scripts/jobs.ts", "create-admin": "src/scripts/create-admin.ts" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  // npm dependencies stay external (installed in production with `pnpm deploy`);
  // workspace packages are TypeScript sources and are bundled in.
  plugins: [
    {
      name: "externalize-npm",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("@workspace/") || args.path.startsWith("node:")) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
await cp("../../lib/db/migrations", "dist/migrations", { recursive: true });
console.log("api-server built to dist/");
