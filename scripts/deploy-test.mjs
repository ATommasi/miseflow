import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const VAULT = "/home/atommasi/Documents/Obsidian Vault";
const TEST_ID = "miseflow-test";
const DEST = join(VAULT, ".obsidian", "plugins", TEST_ID);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.id = TEST_ID;
manifest.name = `${manifest.name} (Test)`;

mkdirSync(DEST, { recursive: true });
writeFileSync(join(DEST, "manifest.json"), JSON.stringify(manifest, null, "\t"));
copyFileSync("main.js", join(DEST, "main.js"));
copyFileSync("styles.css", join(DEST, "styles.css"));

console.log(`Deployed to ${DEST}`);
