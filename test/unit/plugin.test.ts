import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import plugin, { sessionIdFor, toToolResult, TOOL_NAMES } from "../../openclaw-plugin/index.ts";

const manifest = JSON.parse(readFileSync(new URL("../../openclaw-plugin/openclaw.plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../../openclaw-plugin/package.json", import.meta.url), "utf8"));

/** Run register() against a fake API and collect the tools it builds. */
function registeredTools(ctx = { sessionKey: "whatsapp:test" }) {
  const tools: { optsName: string; tool: any }[] = [];
  plugin.register({ registerTool: (factory: any, opts: { name: string }) => tools.push({ optsName: opts.name, tool: factory(ctx) }) });
  return tools;
}

test("manifest id/tools match the plugin and package entry", () => {
  assert.equal(manifest.id, plugin.id);
  assert.deepEqual([...manifest.contracts.tools].sort(), [...TOOL_NAMES].sort());
  assert.deepEqual(pkg.openclaw.extensions, ["./index.ts"]);
  assert.ok(manifest.configSchema && manifest.activation.onStartup);
});

test("register() builds exactly the declared tools, with matching names", () => {
  const tools = registeredTools();
  assert.deepEqual(tools.map((t) => t.optsName).sort(), [...TOOL_NAMES].sort());
  for (const { optsName, tool } of tools) assert.equal(tool.name, optsName);
});

// Without this, Code Mode hides plugin tools behind a catalog and the model answers from memory.
test("every tool is direct-only (always visible to the model)", () => {
  for (const { tool } of registeredTools()) assert.equal(tool.catalogMode, "direct-only", tool.name);
});

test("tool parameter schemas are well-formed JSON Schema objects", () => {
  for (const { tool } of registeredTools()) {
    const s = tool.parameters;
    assert.equal(s.type, "object", tool.name);
    assert.equal(s.additionalProperties, false, tool.name);
    for (const req of s.required) assert.ok(req in s.properties, `${tool.name}: required '${req}' missing`);
    for (const [k, v] of Object.entries<any>(s.properties)) assert.ok(v.type && v.description, `${tool.name}.${k}`);
    assert.ok(tool.description.length > 80, `${tool.name} needs a descriptive description`);
  }
});

test("property and semantic search accept several property types; params say not to guess", () => {
  const byName = Object.fromEntries(registeredTools().map(({ tool }) => [tool.name, tool]));
  for (const name of ["idx_property_search", "idx_semantic_search"]) {
    const p = byName[name].parameters.properties;
    assert.equal(p.propertyTypes.type, "array", name);
    assert.deepEqual(p.propertyTypes.items.enum, ["SingleFamilyResidence", "Condominium", "Townhouse"]);
    for (const k of ["maxPrice", "minBeds"]) assert.match(p[k].description, /never guess/, `${name}.${k}`);
  }
});

test("each conversation gets its own session id, and /new (new sessionId) starts fresh", () => {
  assert.equal(sessionIdFor({ sessionKey: "agent:coordinator:wa", sessionId: "s1" }), "openclaw:s1");
  assert.notEqual(
    sessionIdFor({ sessionKey: "agent:coordinator:wa", sessionId: "s1" }),
    sessionIdFor({ sessionKey: "agent:coordinator:wa", sessionId: "s2" }),
  );
  assert.equal(sessionIdFor({ sessionKey: "a" }), "openclaw:a");
  assert.notEqual(sessionIdFor({ sessionKey: "a" }), sessionIdFor({ sessionKey: "b" }));
  assert.equal(sessionIdFor({ requesterSenderId: "+1555" }), "openclaw:+1555");
  assert.equal(sessionIdFor({}), "openclaw:default");
});

test("tool results tell the model the status and how to use it", () => {
  const r = toToolResult({ status: "needs_input", intent: "property_search", response: "What is your maximum budget?" });
  const text = r.content[0]!.text;
  assert.match(text, /^status: needs_input\n/);
  assert.match(text, /follow-up question/);
  assert.ok(text.endsWith("---\nWhat is your maximum budget?"));
  assert.deepEqual(r.details, { status: "needs_input", intent: "property_search", data: null });
});

test("bundled skill is declared and its name matches its folder", () => {
  assert.deepEqual(manifest.skills, ["./skills"]);
  const skill = readFileSync(new URL("../../openclaw-plugin/skills/idx-real-estate/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^---\nname: idx-real-estate\ndescription: .{20,160}\n---/);
  for (const name of TOOL_NAMES) assert.ok(skill.includes(name), `skill mentions ${name}`);
});
