import {
  renderShellExports,
  resolveBundledBootstrapEnvironment,
} from "../bootstrap/bundled-runtime.js";

async function main() {
  const env = await resolveBundledBootstrapEnvironment(process.env);
  const output = renderShellExports(env);
  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap] ${message}`);
  process.exit(1);
});
