import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "./child-backend";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { hostProviders } from "./providers";
import {
  acquireHarnessBridge,
  configureChildBackend,
} from "../src/integrations/harness/core/child";

const fixture = `const http = require('node:http');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.20.0'); process.exit(0); }
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7));
const subscribers = new Set();
const session = {id: 'fixture_open', directory: process.cwd()};
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/event')) {
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.flushHeaders();
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
    return;
  }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/session' || path === '/session/fixture_open') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(session));
    return;
  }
  if (path === '/session/fixture_open/message') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end('[]');
    return;
  }
  const emit = (text) => setTimeout(() => {
    const id = 'msg' + Math.random();
    const events = [
      {type: 'message.updated', properties: {info: {sessionID: 'fixture_open', id, role: 'assistant'}}},
      {type: 'message.part.updated', properties: {part: {sessionID: 'fixture_open', id: 'part' + id, messageID: id, type: 'text', text}}},
      {type: 'session.status', properties: {sessionID: 'fixture_open', status: {type: 'idle'}}},
    ];
    for (const subscriber of subscribers) for (const event of events)
      subscriber.write('data: ' + JSON.stringify(event) + '\\n\\n');
  }, 30);
  if (path === '/command') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify([{name: 'review', description: 'Review changes', source: 'command'}]));
    return;
  }
  if (path === '/session/fixture_open/command') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      const input = JSON.parse(body);
      emit('Command ran: ' + input.command + ' ' + input.arguments + ' with ' + input.model);
      // Like OpenCode, answer only once the command's turn is over.
      setTimeout(() => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{}'); }, 60);
    });
    return;
  }
  if (path === '/session/fixture_open/prompt_async') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      res.writeHead(204); res.end();
      const text = JSON.parse(body).parts?.[0]?.text ?? '';
      emit(text.startsWith('/') ? 'Prompted: ' + text : 'Headless OpenCode completed');
    });
    return;
  }
  res.writeHead(204); res.end();
});
server.listen(port, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + port));
`;

let directory: string;
let store: HostStore;
let engine: HostEngine;
let backend: HostChildBackend;
let release: () => void;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "monocode-opencode-transport-"));
  const binary = join(directory, "opencode.cjs");
  writeFileSync(binary, fixture);
  backend = new HostChildBackend({ opencode: binary });
  configureChildBackend(backend);
  release = await acquireHarnessBridge();
  store = new HostStore(join(directory, "host.db"));
  engine = new HostEngine(store, hostProviders);
});

afterAll(async () => {
  await engine?.close();
  await backend?.close();
  release?.();
  store?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("runs an OpenCode session through the host HTTP and SSE bridge", async () => {
  const project = await engine.openProject(directory);
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create-opencode",
    projectId: project.id,
    harness: "opencode",
    model: "opencode:openai/fixture-model",
    runtimeMode: "supervised",
  });
  engine.command({
    type: "send",
    commandId: "send-opencode",
    sessionId,
    text: "hello",
  });
  await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), {
    timeout: 8_000,
  });
  const state = store.session(sessionId).session;
  expect(state.blocks.at(-1)?.text).toContain("Headless OpenCode completed");
  expect(state.providerSessionId).toBe("fixture_open");
});

it("runs OpenCode commands through its command endpoint and sends other slash text as a prompt", async () => {
  const project = await engine.openProject(directory);
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create-opencode-command",
    projectId: project.id,
    harness: "opencode",
    model: "opencode:openai/fixture-model",
    runtimeMode: "supervised",
  });
  engine.command({ type: "send", commandId: "send-command", sessionId, text: "/review src/app" });
  await vi.waitFor(() => expect(store.session(sessionId).session.blocks.at(-1)?.text)
    .toContain("Command ran: review src/app with openai/fixture-model"), { timeout: 8_000 });
  await vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 8_000 });
  engine.command({ type: "send", commandId: "send-unknown", sessionId, text: "/nope keep" });
  await vi.waitFor(() => expect(store.session(sessionId).session.blocks.at(-1)?.text)
    .toContain("Prompted: /nope keep"), { timeout: 8_000 });
});
