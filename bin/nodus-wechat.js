#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const VERSION = "0.6.1";
const DEFAULT_BASE_URL = "https://api.nodus.sbs/";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_OPENILINK_ORIGIN = "http://localhost:9800";
const DEFAULT_OPENILINK_RP_ID = "localhost";
const DEFAULT_OPENILINK_PORT = 9800;
const DEFAULT_WEBHOOK_PORT = 9811;
const TEMPLATE_DIR = path.join(__dirname, "..", "templates", "wechat-agent-poc");

function configHome() {
  return process.env.NODUS_WECHAT_HOME || path.join(os.homedir(), ".nodus-wechat");
}

function configPath() {
  return path.join(configHome(), "config.json");
}

function hermesHome() {
  return process.env.NODUS_HERMES_HOME || path.join(os.homedir(), ".hermes");
}

function printHelp() {
  console.log(`nodus-wechat ${VERSION}

Local CLI installer for Nodus WeChat, Hermes settings, and the OpeniLink webhook runtime.

Usage:
  nodus-wechat [--api-key <key>] [--base-url <url>] [--model <model>]
  nodus-wechat setup [--api-key <key>] [--base-url <url>] [--model <model>]
                      [--runtime-dir <path>] [--openilink-origin <url>]
                      [--openilink-rp-id <id>] [--webhook-port <port>]
                      [--webhook-token <token>] [--install-hermes]
  nodus-wechat install-hermes
  nodus-wechat install-openilink
  nodus-wechat doctor
  nodus-wechat start [--docker]
  nodus-wechat status [--docker]
  nodus-wechat logs [--docker]
  nodus-wechat stop [--docker]
  nodus-wechat uninstall --yes
  nodus-wechat clean --yes

Commands:
  setup           Create or update local configuration and runtime files. This is the default.
  install-hermes  Install Hermes Agent CLI with the official installer.
  install-openilink
                  Install OpeniLink Hub native CLI with the official installer.
  doctor          Check local prerequisites and configuration.
  start           Start OpeniLink + webhook with local processes by default.
  status          Show local process status.
  logs            Follow local runtime logs.
  stop            Stop the local runtime.
  uninstall       Remove Nodus WeChat config and runtime files.
  clean           Stop runtime if possible, then remove Nodus WeChat files and generated Hermes settings.

This version installs an OpeniLink webhook POC runtime. It does not inject into,
read, or control WeChat directly.`);
}

function parseArgs(argv) {
  const result = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      result._.push(item);
      continue;
    }

    const key = item.slice(2);
    if (key === "help" || key === "yes" || key === "install-hermes" || key === "docker") {
      result[key] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    result[key] = value;
    index += 1;
  }

  return result;
}

function readConfig() {
  return JSON.parse(fs.readFileSync(configPath(), "utf8"));
}

function writeConfig(config) {
  fs.mkdirSync(configHome(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

function parsePositiveInt(value, name) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for --${name}: ${value}`);
  }
  return parsed;
}

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function promptApiKey() {
  if (process.stdin.isTTY && process.platform !== "win32") {
    const result = childProcess.spawnSync(
      "sh",
      [
        "-c",
        [
          'printf "Paste AstraGate API Key: " > /dev/tty',
          "stty -echo < /dev/tty",
          "IFS= read -r key < /dev/tty",
          "status=$?",
          "stty echo < /dev/tty",
          'printf "\\n" > /dev/tty',
          'printf "%s" "$key"',
          "exit $status",
        ].join("; "),
      ],
      { encoding: "utf8" },
    );
    if (!result.error && result.status === 0) {
      return (result.stdout || "").trim();
    }
  }

  process.stderr.write("Paste AstraGate API Key: ");
  return fs.readFileSync(0, "utf8").split(/\r?\n/)[0].trim();
}

function resolveApiKey(options, existing) {
  const apiKey = options["api-key"] || process.env.NODUS_WECHAT_API_KEY || existing.sub2api?.apiKey || "";
  if (apiKey) {
    return apiKey;
  }

  const prompted = promptApiKey();
  if (!prompted) {
    throw new Error("AstraGate API Key is required. Rerun setup and paste the key, or pass --api-key <key>.");
  }
  return prompted;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function buildHermesConfig(config) {
  return [
    "_config_version: 10",
    "model:",
    `  default: ${yamlString(config.agent.model)}`,
    '  provider: "custom"',
    `  base_url: ${yamlString(config.sub2api.baseUrl)}`,
    '  api_key: "${ASTRAGATE_API_KEY}"',
    "agent:",
    `  reasoning_effort: ${yamlString(config.agent.reasoningEffort)}`,
    "terminal:",
    '  backend: "local"',
    '  cwd: "."',
    "approvals:",
    '  mode: "manual"',
    "toolsets:",
    '  - "all"',
    "display:",
    '  tool_progress: "all"',
    "compression:",
    "  enabled: true",
    "",
  ].join("\n");
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(filePath, `${filePath}.bak-${stamp}`);
}

function writeHermesEnv(envPath, apiKey) {
  const existingLines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const kept = existingLines.filter((line) => !line.startsWith("ASTRAGATE_API_KEY=") && line.trim() !== "");
  kept.push(`ASTRAGATE_API_KEY=${apiKey}`);
  fs.writeFileSync(envPath, `${kept.join("\n")}\n`, { mode: 0o600 });
}

function installHermesConfig(config) {
  fs.mkdirSync(config.hermes.home, { recursive: true, mode: 0o700 });
  backupIfExists(config.hermes.configPath);
  backupIfExists(config.hermes.envPath);
  fs.writeFileSync(config.hermes.configPath, buildHermesConfig(config), { mode: 0o600 });
  writeHermesEnv(config.hermes.envPath, config.sub2api.apiKey);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function hermesInstallCommand() {
  return (
    process.env.NODUS_WECHAT_HERMES_INSTALL_COMMAND ||
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s --"
  );
}

function openiLinkInstallCommand() {
  return (
    process.env.NODUS_WECHAT_OPENILINK_INSTALL_COMMAND ||
    "curl -fsSL https://raw.githubusercontent.com/openilink/openilink-hub/main/install.sh | sh"
  );
}

function runHermesInstaller(hermesDir) {
  const args = ["--skip-setup", "--hermes-home", hermesDir];
  const command = `${hermesInstallCommand()} ${args.map(shellQuote).join(" ")}`;
  const result = childProcess.spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, HERMES_HOME: hermesDir },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Hermes installer failed with exit code ${result.status}`);
  }
}

function writeRuntimeEnv(config, options) {
  const envPath = path.join(config.runtime.dir, ".env");
  const existing = parseDotEnv(envPath);
  const webhookToken = options["webhook-token"] ?? existing.POC_WEBHOOK_TOKEN ?? "";
  const lines = [
    "OPENILINK_PORT=" + config.openilink.port,
    "OPENILINK_DATA_DIR=" + path.join(config.runtime.dir, "openilink-hub-data"),
    "POC_WEBHOOK_PORT=" + config.webhook.port,
    "POC_WEBHOOK_BIND=127.0.0.1",
    "",
    "OPENILINK_PUBLIC_ORIGIN=" + config.openilink.publicOrigin,
    "OPENILINK_RP_ID=" + config.openilink.rpId,
    "",
    "POC_WEBHOOK_TOKEN=" + webhookToken,
    "",
  ];

  fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
}

function installRuntime(config, options) {
  fs.mkdirSync(config.runtime.dir, { recursive: true, mode: 0o700 });
  fs.cpSync(TEMPLATE_DIR, config.runtime.dir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  const scriptsDir = path.join(config.runtime.dir, "scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const fileName of fs.readdirSync(scriptsDir)) {
      if (fileName.endsWith(".sh")) {
        fs.chmodSync(path.join(scriptsDir, fileName), 0o755);
      }
    }
  }

  writeRuntimeEnv(config, options);
}

function createConfig(options) {
  const existing = fs.existsSync(configPath()) ? readConfig() : {};
  const now = new Date().toISOString();
  const runtimeDir = options["runtime-dir"] || existing.runtime?.dir || path.join(configHome(), "runtime");
  const openilinkPort = parsePositiveInt(options["openilink-port"], "openilink-port") || existing.openilink?.port || DEFAULT_OPENILINK_PORT;
  const webhookPort = parsePositiveInt(options["webhook-port"], "webhook-port") || existing.webhook?.port || DEFAULT_WEBHOOK_PORT;
  const hermesDir = options["hermes-home"] || existing.hermes?.home || hermesHome();
  const apiKey = resolveApiKey(options, existing);

  return {
    schemaVersion: 1,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    sub2api: {
      baseUrl: options["base-url"] || existing.sub2api?.baseUrl || DEFAULT_BASE_URL,
      apiKey,
    },
    agent: {
      model: options.model || existing.agent?.model || DEFAULT_MODEL,
      reasoningEffort: existing.agent?.reasoningEffort || "high",
      approvalMode: existing.agent?.approvalMode || "wechat-confirm",
    },
    wechat: {
      connector: "openilink",
      appPath: existing.wechat?.appPath || null,
      status: "pending",
    },
    openilink: {
      publicOrigin: options["openilink-origin"] || existing.openilink?.publicOrigin || DEFAULT_OPENILINK_ORIGIN,
      rpId: options["openilink-rp-id"] || existing.openilink?.rpId || DEFAULT_OPENILINK_RP_ID,
      port: openilinkPort,
    },
    webhook: {
      port: webhookPort,
      bind: "127.0.0.1",
      tokenConfigured: Boolean(options["webhook-token"] || existing.webhook?.tokenConfigured),
    },
    runtime: {
      status: "installed",
      dir: runtimeDir,
      composeFile: path.join(runtimeDir, "docker-compose.yml"),
    },
    hermes: {
      status: "configured",
      home: hermesDir,
      configPath: path.join(hermesDir, "config.yaml"),
      envPath: path.join(hermesDir, ".env"),
    },
    ilink: {
      status: "not_installed",
    },
  };
}

function setup(options) {
  const config = createConfig(options);
  installRuntime(config, options);
  installHermesConfig(config);
  if (options["install-hermes"]) {
    runHermesInstaller(config.hermes.home);
  }
  writeConfig(config);

  console.log(`Config written: ${configPath()}`);
  console.log(`Runtime installed: ${config.runtime.dir}`);
  console.log(`Hermes configured: ${config.hermes.configPath}`);
  if (!options["install-hermes"]) {
    console.log("Hermes CLI install skipped. Run `nodus-wechat install-hermes` if `hermes` is not installed.");
  }
  console.log(`Gateway Base URL: ${config.sub2api.baseUrl}`);
  console.log(`Model: ${config.agent.model}`);
  console.log(`OpeniLink Hub: ${config.openilink.publicOrigin}`);
  console.log(`Webhook URL for OpeniLink: http://poc-webhook:${config.webhook.port}/webhook`);
  console.log("Runtime mode: host process by default; Docker is used only with `--docker`.");
  console.log("Run `nodus-wechat start` to start the local host runtime.");
}

function installHermes() {
  const config = fs.existsSync(configPath())
    ? readConfig()
    : { hermes: { home: hermesHome() } };
  const hermesDir = config.hermes?.home || hermesHome();
  runHermesInstaller(hermesDir);
  console.log(`Hermes installer completed for: ${hermesDir}`);
  return 0;
}

function installOpeniLink() {
  const result = childProcess.spawnSync(openiLinkInstallCommand(), {
    shell: true,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`OpeniLink installer failed with exit code ${result.status}`);
  }
  console.log("OpeniLink installer completed. Run `nodus-wechat start`.");
  return 0;
}

function doctor() {
  let ok = true;
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 18) {
    console.log(`node: ok (${process.version})`);
  } else {
    ok = false;
    console.log(`node: failed (${process.version}); Node.js >=18 is required`);
  }

  try {
    fs.mkdirSync(configHome(), { recursive: true, mode: 0o700 });
    fs.accessSync(configHome(), fs.constants.W_OK);
    console.log(`config directory: ok (${configHome()})`);
  } catch (error) {
    ok = false;
    console.log(`config directory: failed (${error.message})`);
  }

  if (!fs.existsSync(configPath())) {
    console.log(`config: missing (${configPath()})`);
    return 1;
  }

  try {
    const config = readConfig();
    console.log("config: ok");
    if (config.sub2api?.apiKey) {
      console.log("sub2api: ok (api key configured)");
    } else {
      ok = false;
      console.log("sub2api: failed (api key missing)");
    }
    if (config.runtime?.dir && fs.existsSync(path.join(config.runtime.dir, "docker-compose.yml"))) {
      console.log(`runtime: installed (${config.runtime.dir})`);
    } else {
      ok = false;
      console.log(`runtime: missing (${config.runtime?.dir || path.join(configHome(), "runtime")})`);
    }
    const python = commandPath("python3") || commandPath("python");
    if (python) {
      console.log(`python: ok (${python})`);
    } else {
      ok = false;
      console.log("python: failed (needed for local webhook runtime)");
    }
    const oih = commandPath("oih");
    if (oih) {
      console.log(`openilink cli: ok (${oih})`);
    } else {
      console.log("openilink cli: missing (run `nodus-wechat install-openilink`)");
    }
    const docker = dockerComposeAvailable();
    if (docker.ok) {
      console.log(`docker compose: ok (${docker.version}; optional with --docker)`);
    } else {
      console.log("docker compose: missing (optional; only needed for `--docker`)");
    }
    console.log(`openilink: ${config.openilink?.publicOrigin || DEFAULT_OPENILINK_ORIGIN}`);
    console.log(`webhook: http://127.0.0.1:${config.webhook?.port || DEFAULT_WEBHOOK_PORT}/health`);
    const hermesConfigPath = config.hermes?.configPath || path.join(hermesHome(), "config.yaml");
    const hermesEnvPath = config.hermes?.envPath || path.join(hermesHome(), ".env");
    const hermesEnv = parseDotEnv(hermesEnvPath);
    if (fs.existsSync(hermesConfigPath) && hermesEnv.ASTRAGATE_API_KEY) {
      console.log(`hermes: configured (${hermesConfigPath})`);
    } else {
      ok = false;
      console.log(`hermes: missing (${hermesConfigPath})`);
    }
    const hermesCli = childProcess.spawnSync("hermes", ["--version"], { encoding: "utf8" });
    if (hermesCli.error || hermesCli.status !== 0) {
      console.log("hermes cli: missing (config is ready; install Hermes before using it)");
    } else {
      console.log(`hermes cli: ok (${(hermesCli.stdout || hermesCli.stderr || "").trim()})`);
    }
    console.log(`ilink: ${config.ilink?.status || "not_installed"}`);
    console.log(`wechat: ${findWeChatApp() || "not detected"}`);
  } catch (error) {
    ok = false;
    console.log(`config: failed (${error.message})`);
  }

  return ok ? 0 : 1;
}

function findWeChatApp() {
  const candidates = ["/Applications/WeChat.app", "/Applications/微信.app"];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function dockerComposeAvailable() {
  const result = childProcess.spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return { ok: false };
  }

  return {
    ok: true,
    version: (result.stdout || result.stderr || "").trim(),
  };
}

function commandPath(name) {
  const result = childProcess.spawnSync("/bin/sh", ["-c", `command -v ${shellQuote(name)}`], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function runtimePath(config, name) {
  return path.join(config.runtime.dir, name);
}

function pidPath(config, name) {
  return runtimePath(config, `.nodus-${name}.pid`);
}

function logPath(config, name) {
  return runtimePath(config, `${name}.log`);
}

function readPid(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const pid = Number.parseInt(fs.readFileSync(filePath, "utf8"), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function processRunning(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function startManagedProcess(config, name, command, args, env) {
  const filePath = pidPath(config, name);
  const existingPid = readPid(filePath);
  if (processRunning(existingPid)) {
    console.log(`${name}: already running (pid ${existingPid})`);
    return 0;
  }

  fs.mkdirSync(config.runtime.dir, { recursive: true, mode: 0o700 });
  const out = fs.openSync(logPath(config, name), "a");
  const child = childProcess.spawn(command, args, {
    cwd: config.runtime.dir,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.writeFileSync(filePath, `${child.pid}\n`, { mode: 0o600 });
  console.log(`${name}: started (pid ${child.pid}, log ${logPath(config, name)})`);
  return 0;
}

function stopManagedProcess(config, name) {
  const filePath = pidPath(config, name);
  const pid = readPid(filePath);
  if (!processRunning(pid)) {
    fs.rmSync(filePath, { force: true });
    console.log(`${name}: stopped`);
    return 0;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch (_error) {
    process.kill(pid, "SIGTERM");
  }
  fs.rmSync(filePath, { force: true });
  console.log(`${name}: stopped (pid ${pid})`);
  return 0;
}

function localRuntimeEnv(config) {
  const env = parseDotEnv(path.join(config.runtime.dir, ".env"));
  return {
    ...process.env,
    ...env,
    LISTEN: `:${config.openilink?.port || DEFAULT_OPENILINK_PORT}`,
    RP_ORIGIN: config.openilink?.publicOrigin || DEFAULT_OPENILINK_ORIGIN,
    RP_ID: config.openilink?.rpId || DEFAULT_OPENILINK_RP_ID,
    POC_WEBHOOK_BIND: config.webhook?.bind || "127.0.0.1",
    POC_WEBHOOK_PORT: String(config.webhook?.port || DEFAULT_WEBHOOK_PORT),
  };
}

function httpGet(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on("end", () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode }));
    });
    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false });
    });
    request.on("error", () => resolve({ ok: false }));
  });
}

function loadRuntimeConfig() {
  if (!fs.existsSync(configPath())) {
    console.error(`Config missing: ${configPath()}`);
    console.error("Run: nodus-wechat setup --api-key <key>");
    return null;
  }

  const config = readConfig();
  const runtimeDir = config.runtime?.dir || path.join(configHome(), "runtime");
  if (!fs.existsSync(path.join(runtimeDir, "docker-compose.yml"))) {
    console.error(`Runtime missing: ${runtimeDir}`);
    console.error("Run: nodus-wechat setup");
    return null;
  }

  return { ...config, runtime: { ...config.runtime, dir: runtimeDir } };
}

function runDockerCompose(config, args, stdio = "inherit") {
  const docker = dockerComposeAvailable();
  if (!docker.ok) {
    console.error("Docker Compose is required for this command.");
    console.error("Install Docker Desktop or OrbStack, then rerun `nodus-wechat start`.");
    return 1;
  }

  const result = childProcess.spawnSync("docker", ["compose", ...args], {
    cwd: config.runtime.dir,
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
  });

  if (stdio === "pipe" && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (stdio === "pipe" && result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result.status || 0;
}

function startDocker() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  return runDockerCompose(config, ["up", "-d"]);
}

function startLocal() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  const python = commandPath("python3") || commandPath("python");
  if (!python) {
    console.error("Python is required for the local webhook runtime.");
    return 1;
  }

  const oih = commandPath("oih");
  if (!oih) {
    console.error("OpeniLink Hub CLI `oih` is not installed.");
    console.error("Run: nodus-wechat install-openilink");
    return 1;
  }

  const env = localRuntimeEnv(config);
  const webhookPath = path.join(config.runtime.dir, "poc-webhook", "server.py");
  startManagedProcess(config, "webhook", python, [webhookPath], env);
  startManagedProcess(config, "openilink", oih, [], env);
  console.log(`OpeniLink Hub: ${config.openilink?.publicOrigin || DEFAULT_OPENILINK_ORIGIN}`);
  console.log(`Webhook health: http://127.0.0.1:${config.webhook?.port || DEFAULT_WEBHOOK_PORT}/health`);
  return 0;
}

function start(options) {
  return options.docker ? startDocker() : startLocal();
}

function statusDocker() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  return runDockerCompose(config, ["ps"]);
}

async function statusLocal() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  for (const name of ["openilink", "webhook"]) {
    const pid = readPid(pidPath(config, name));
    console.log(`${name}: ${processRunning(pid) ? `running (pid ${pid})` : "stopped"}`);
  }
  const health = await httpGet(`http://127.0.0.1:${config.webhook?.port || DEFAULT_WEBHOOK_PORT}/health`);
  console.log(`webhook health: ${health.ok ? `ok (${health.statusCode})` : "unreachable"}`);
  return 0;
}

function status(options) {
  return options.docker ? statusDocker() : statusLocal();
}

function logsDocker() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  return runDockerCompose(config, ["logs", "-f", "poc-webhook"]);
}

function logsLocal() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  const files = ["openilink", "webhook"].map((name) => logPath(config, name)).filter((filePath) => fs.existsSync(filePath));
  if (files.length === 0) {
    console.error("No local runtime logs found.");
    return 1;
  }

  const tail = commandPath("tail");
  if (!tail) {
    for (const filePath of files) {
      console.log(`==> ${filePath} <==`);
      console.log(fs.readFileSync(filePath, "utf8"));
    }
    return 0;
  }

  const result = childProcess.spawnSync(tail, ["-f", ...files], { stdio: "inherit" });
  return result.status || 0;
}

function logs(options) {
  return options.docker ? logsDocker() : logsLocal();
}

function stopDocker() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  return runDockerCompose(config, ["down"]);
}

function stopLocal() {
  const config = loadRuntimeConfig();
  if (!config) {
    return 1;
  }

  stopManagedProcess(config, "webhook");
  stopManagedProcess(config, "openilink");
  return 0;
}

function stop(options) {
  return options.docker ? stopDocker() : stopLocal();
}

function uninstall(options) {
  if (!options.yes) {
    console.error("Refusing to uninstall without --yes.");
    return 1;
  }

  fs.rmSync(configHome(), { recursive: true, force: true });
  console.log(`Removed: ${configHome()}`);
  return 0;
}

function removeHermesApiKey(envPath) {
  if (!fs.existsSync(envPath)) {
    return "missing";
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const kept = lines.filter((line) => line && !line.startsWith("ASTRAGATE_API_KEY="));
  if (kept.length === 0) {
    fs.rmSync(envPath, { force: true });
    return "removed";
  }

  fs.writeFileSync(envPath, `${kept.join("\n")}\n`, { mode: 0o600 });
  return "updated";
}

function removeGeneratedHermesConfig(config) {
  const hermesConfigPath = config.hermes?.configPath || path.join(hermesHome(), "config.yaml");
  if (!fs.existsSync(hermesConfigPath)) {
    return "missing";
  }

  const current = fs.readFileSync(hermesConfigPath, "utf8");
  if (current !== buildHermesConfig(config)) {
    return "kept";
  }

  fs.rmSync(hermesConfigPath, { force: true });
  return "removed";
}

function clean(options) {
  if (!options.yes) {
    console.error("Refusing to clean without --yes.");
    return 1;
  }

  const config = fs.existsSync(configPath()) ? readConfig() : null;
  if (config) {
    for (const name of ["webhook", "openilink"]) {
      stopManagedProcess({ ...config, runtime: { ...config.runtime, dir: config.runtime?.dir || path.join(configHome(), "runtime") } }, name);
    }
    const docker = dockerComposeAvailable();
    if (docker.ok && config.runtime?.dir && fs.existsSync(path.join(config.runtime.dir, "docker-compose.yml"))) {
      runDockerCompose(config, ["down"], "pipe");
    }

    const hermesConfigStatus = removeGeneratedHermesConfig(config);
    const hermesEnvStatus = removeHermesApiKey(config.hermes?.envPath || path.join(hermesHome(), ".env"));
    console.log(`Hermes config: ${hermesConfigStatus}`);
    console.log(`Hermes env: ${hermesEnvStatus}`);
  }

  fs.rmSync(configHome(), { recursive: true, force: true });
  console.log(`Removed: ${configHome()}`);
  return 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const command = args._[0] || "setup";
  if (args.help || command === "help") {
    printHelp();
    return 0;
  }

  try {
    if (command === "setup") {
      setup(args);
      return 0;
    }

    if (command === "install-hermes") {
      return installHermes();
    }

    if (command === "install-openilink") {
      return installOpeniLink();
    }

    if (command === "doctor") {
      return doctor();
    }

    if (command === "start") {
      return start(args);
    }

    if (command === "status") {
      return await status(args);
    }

    if (command === "logs") {
      return logs(args);
    }

    if (command === "stop") {
      return stop(args);
    }

    if (command === "uninstall") {
      return uninstall(args);
    }

    if (command === "clean") {
      return clean(args);
    }
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
