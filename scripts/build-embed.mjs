import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["embed/src/index.ts"],
  outfile: "dist/embed/kb.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const bytes = Object.values(result.metafile.outputs)[0].bytes;
  console.log(`embed: ${(bytes / 1024).toFixed(1)} KB minified`);
}
