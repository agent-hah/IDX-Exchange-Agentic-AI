import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, envFilePath, loadEnvFile } from "../../src/config.ts";
import { loadProjectEnv } from "../../openclaw-plugin/index.ts";

function fakeRepo(envContents: string) {
  const root = mkdtempSync(join(tmpdir(), "idx-repo-"));
  mkdirSync(join(root, "openclaw-plugin"));
  writeFileSync(join(root, "openclaw-plugin", "index.ts"), "");
  writeFileSync(join(root, ".env"), envContents);
  return root;
}

// The bug seen in OpenClaw: the Gateway inherited a stale MYSQL_PASSWORD, and it won.
test(".env values win over inherited process environment variables", () => {
  process.env.MYSQL_PASSWORD = "stale-from-gateway";
  process.env.MYSQL_USER = "gateway-user";
  const root = fakeRepo("MYSQL_USER=root\nMYSQL_PASSWORD=correct\nMYSQL_HOST=10.0.0.5\n");
  assert.equal(loadEnvFile(join(root, ".env")), true);
  assert.equal(config.mysql.password, "correct");
  assert.equal(config.mysql.user, "root");
  assert.equal(config.mysql.host, "10.0.0.5");
  assert.equal(process.env.MYSQL_PASSWORD, "stale-from-gateway", "process.env is never modified");
});

test("variables missing from .env fall back to the environment, then defaults", () => {
  const root = fakeRepo("MYSQL_PASSWORD=x\n");
  loadEnvFile(join(root, ".env"));
  process.env.EMBED_TPM = "123456";
  assert.equal(config.embeddings.tokensPerMinute, 123456);
  delete process.env.EMBED_TPM;
  assert.equal(config.embeddings.tokensPerMinute, 25_000);
  assert.equal(config.mysql.database, "idx_exchange");
  assert.equal(config.mysql.port, 3306);
});

test("loadEnvFile ignores missing files and keeps the current settings", () => {
  const root = fakeRepo("MYSQL_PASSWORD=keep\n");
  loadEnvFile(join(root, ".env"));
  assert.equal(loadEnvFile(join(root, "nope.env")), false);
  assert.equal(config.mysql.password, "keep");
  assert.equal(envFilePath(), join(root, ".env"));
});

// OpenClaw runs a copy of the plugin from a temp folder; api.source still points at the repo.
test("plugin finds the repo .env from its real install location", () => {
  const root = fakeRepo("MYSQL_PASSWORD=from-repo\n");
  const used = loadProjectEnv({ source: join(root, "openclaw-plugin", "index.ts"), rootDir: "/tmp/openclaw-capture-xyz" });
  assert.equal(used, join(root, "openclaw-plugin", "..", ".env"));
  assert.equal(config.mysql.password, "from-repo");
});

test("an explicit envFile plugin setting takes priority", () => {
  const root = fakeRepo("MYSQL_PASSWORD=from-repo\n");
  const other = fakeRepo("MYSQL_PASSWORD=explicit\n");
  loadProjectEnv({ source: join(root, "openclaw-plugin", "index.ts"), pluginConfig: { envFile: join(other, ".env") } });
  assert.equal(config.mysql.password, "explicit");
});
