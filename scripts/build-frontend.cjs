"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { publicFiles, prepareContent } = require("../static-resources.cjs");

async function build(root = path.resolve(__dirname, "..")) {
  const output = path.join(root, "dist");
  await fs.rm(output, { recursive: true, force: true });
  // Share the backend's explicit public allowlist. Never copy the repository.
  for (const [route, [file]] of Object.entries(publicFiles)) {
    if (route === "/") continue;
    const target = path.join(output, route.slice(1));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = await fs.readFile(path.join(root, file));
    // Production geocoding uses LocationIQ; attribution does not require its key.
    await fs.writeFile(target, prepareContent(file, content, true));
  }
  return output;
}

if (require.main === module) {
  build().then(() => console.log("Interface pública pronta em dist/."))
    .catch(() => { console.error("Não foi possível gerar a interface. Confira os arquivos públicos e execute npm ci."); process.exitCode = 1; });
}
module.exports = { build };
