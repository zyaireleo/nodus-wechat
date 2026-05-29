const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "nodus-wechat.js");

function run(args, env = {}, input = undefined) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
  });
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nodus-wechat-test-"));
}

test("prints help with available commands", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /setup/);
  assert.match(result.stdout, /install-hermes/);
  assert.match(result.stdout, /install-openilink/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /start/);
  assert.match(result.stdout, /uninstall/);
  assert.match(result.stdout, /clean/);
});

test("setup writes config without printing the api key", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const token = "sk-test-secret";
  const result = run(
    [
      "setup",
      "--api-key",
      token,
      "--base-url",
      "https://api.example.test/v1",
      "--model",
      "gpt-5.5",
    ],
    { NODUS_WECHAT_HOME: home, NODUS_HERMES_HOME: hermesHome },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.doesNotMatch(result.stderr, new RegExp(token));

  const configPath = path.join(home, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.sub2api.apiKey, token);
  assert.equal(config.sub2api.baseUrl, "https://api.example.test/v1");
  assert.equal(config.agent.model, "gpt-5.5");
  assert.equal(config.agent.approvalMode, "wechat-confirm");
  assert.equal(config.hermes.status, "configured");
  assert.equal(config.hermes.home, hermesHome);
  assert.equal(config.hermes.configPath, path.join(hermesHome, "config.yaml"));
  assert.equal(config.hermes.envPath, path.join(hermesHome, ".env"));
  assert.equal(config.runtime.status, "installed");
  assert.equal(config.runtime.dir, path.join(home, "runtime"));

  assert.equal(fs.existsSync(path.join(home, "runtime", "docker-compose.yml")), true);
  assert.equal(fs.existsSync(path.join(home, "runtime", "poc-webhook", "server.py")), true);
  assert.equal(fs.existsSync(path.join(home, "runtime", "plugins", "reply-from-webhook.js")), true);

  const env = fs.readFileSync(path.join(home, "runtime", ".env"), "utf8");
  assert.match(env, /OPENILINK_PUBLIC_ORIGIN=http:\/\/localhost:9800/);
  assert.match(env, /OPENILINK_RP_ID=localhost/);
  assert.match(env, /POC_WEBHOOK_PORT=9811/);

  const hermesConfig = fs.readFileSync(path.join(hermesHome, "config.yaml"), "utf8");
  assert.match(hermesConfig, /provider: "custom"/);
  assert.match(hermesConfig, /default: "gpt-5\.5"/);
  assert.match(hermesConfig, /base_url: "https:\/\/api\.example\.test\/v1"/);
  assert.match(hermesConfig, /api_key: "\$\{ASTRAGATE_API_KEY\}"/);

  const hermesEnv = fs.readFileSync(path.join(hermesHome, ".env"), "utf8");
  assert.match(hermesEnv, /ASTRAGATE_API_KEY=sk-test-secret/);
});

test("setup prompts for api key and uses the Nodus gateway by default", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const token = "sk-prompted-secret";

  const result = run(
    ["setup"],
    { NODUS_WECHAT_HOME: home, NODUS_HERMES_HOME: hermesHome },
    `${token}\n`,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.doesNotMatch(result.stderr, new RegExp(token));
  assert.match(result.stderr, /AstraGate API Key/);

  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(config.sub2api.baseUrl, "https://api.nodus.sbs/");
  assert.equal(config.sub2api.apiKey, token);

  const hermesConfig = fs.readFileSync(path.join(hermesHome, "config.yaml"), "utf8");
  assert.match(hermesConfig, /base_url: "https:\/\/api\.nodus\.sbs\/"/);
});

test("bare command runs setup", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const token = "sk-bare-secret";

  const result = run([], { NODUS_WECHAT_HOME: home, NODUS_HERMES_HOME: hermesHome }, `${token}\n`);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /AstraGate API Key/);
  assert.match(result.stdout, /Config written:/);
  assert.match(result.stdout, /Runtime mode: host process by default/);

  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(config.sub2api.baseUrl, "https://api.nodus.sbs/");
  assert.equal(config.sub2api.apiKey, token);
});

test("doctor reports missing config and valid config", () => {
  const home = tempHome();
  const missing = run(["doctor"], { NODUS_WECHAT_HOME: home });

  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /config.*missing/i);

  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: path.join(home, "hermes"),
  });
  assert.equal(setup.status, 0, setup.stderr);

  const valid = run(["doctor"], { NODUS_WECHAT_HOME: home });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /node.*ok/i);
  assert.match(valid.stdout, /config.*ok/i);
  assert.match(valid.stdout, /sub2api.*ok/i);
  assert.match(valid.stdout, /runtime.*installed/i);
  assert.match(valid.stdout, /hermes.*configured/i);
});

test("install-hermes runs the official installer with the configured Hermes home", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const logPath = path.join(home, "install.log");
  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: hermesHome,
  });
  assert.equal(setup.status, 0, setup.stderr);

  const result = run(["install-hermes"], {
    NODUS_WECHAT_HOME: home,
    NODUS_WECHAT_HERMES_INSTALL_COMMAND: `${process.execPath} -e "require('node:fs').writeFileSync(process.argv[1], process.argv.slice(2).join(' '))" ${logPath}`,
  });

  assert.equal(result.status, 0, result.stderr);
  const args = fs.readFileSync(logPath, "utf8");
  assert.match(args, /--skip-setup/);
  assert.match(args, /--hermes-home/);
  assert.match(args, new RegExp(hermesHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("setup can install Hermes when explicitly requested", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const logPath = path.join(home, "setup-install.log");
  const result = run(
    ["setup", "--api-key", "sk-test", "--install-hermes"],
    {
      NODUS_WECHAT_HOME: home,
      NODUS_HERMES_HOME: hermesHome,
      NODUS_WECHAT_HERMES_INSTALL_COMMAND: `${process.execPath} -e "require('node:fs').writeFileSync(process.argv[1], process.argv.slice(2).join(' '))" ${logPath}`,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(logPath, "utf8"), /--skip-setup/);
});

test("install-openilink runs the official installer command", () => {
  const home = tempHome();
  const logPath = path.join(home, "openilink-install.log");

  const result = run(["install-openilink"], {
    NODUS_WECHAT_OPENILINK_INSTALL_COMMAND: `${process.execPath} -e "require('node:fs').writeFileSync(process.argv[1], 'installed')" ${logPath}`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(logPath, "utf8"), "installed");
});

test("start can skip automatic OpeniLink install", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const binDir = path.join(home, "bin");
  fs.mkdirSync(binDir);
  fs.symlinkSync(process.execPath, path.join(binDir, "python3"));

  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: hermesHome,
  });
  assert.equal(setup.status, 0, setup.stderr);

  const result = run(["start", "--no-install"], { NODUS_WECHAT_HOME: home, PATH: binDir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /OpeniLink Hub CLI `oih` is not installed/);
  assert.match(result.stderr, /install-openilink/);
});

test("start installs OpeniLink automatically when missing", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const binDir = path.join(home, "bin");
  const logPath = path.join(home, "openilink-install.log");
  fs.mkdirSync(binDir);
  fs.symlinkSync(process.execPath, path.join(binDir, "python3"));

  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: hermesHome,
  });
  assert.equal(setup.status, 0, setup.stderr);

  const result = run(["start"], {
    NODUS_WECHAT_HOME: home,
    PATH: binDir,
    NODUS_WECHAT_OPENILINK_INSTALL_COMMAND: `${process.execPath} -e "require('node:fs').writeFileSync(process.argv[1], 'installed')" ${logPath}`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /installing it now/);
  assert.equal(fs.readFileSync(logPath, "utf8"), "installed");
  assert.match(result.stderr, /still not on PATH/);
});

test("docker mode remains available explicitly", () => {
  const home = tempHome();
  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: path.join(home, "hermes"),
  });
  assert.equal(setup.status, 0, setup.stderr);

  const result = run(["start", "--docker"], { NODUS_WECHAT_HOME: home, PATH: "" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Docker Compose is required/);
});

test("setup accepts runtime network options", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const runtimeDir = path.join(home, "custom-runtime");
  const result = run(
    [
      "setup",
      "--api-key",
      "sk-test",
      "--runtime-dir",
      runtimeDir,
      "--openilink-origin",
      "http://192.220.25.138:9800",
      "--openilink-rp-id",
      "192.220.25.138",
      "--webhook-port",
      "9911",
      "--webhook-token",
      "secret-webhook-token",
    ],
    { NODUS_WECHAT_HOME: home, NODUS_HERMES_HOME: hermesHome },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /secret-webhook-token/);

  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(config.runtime.dir, runtimeDir);
  assert.equal(config.openilink.publicOrigin, "http://192.220.25.138:9800");
  assert.equal(config.openilink.rpId, "192.220.25.138");
  assert.equal(config.webhook.port, 9911);

  const env = fs.readFileSync(path.join(runtimeDir, ".env"), "utf8");
  assert.match(env, /OPENILINK_PUBLIC_ORIGIN=http:\/\/192\.220\.25\.138:9800/);
  assert.match(env, /OPENILINK_RP_ID=192\.220\.25\.138/);
  assert.match(env, /POC_WEBHOOK_PORT=9911/);
  assert.match(env, /POC_WEBHOOK_TOKEN=secret-webhook-token/);
});

test("uninstall removes local config", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: hermesHome,
  });
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(fs.existsSync(path.join(home, "config.json")), true);

  const result = run(["uninstall", "--yes"], { NODUS_WECHAT_HOME: home });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, "config.json")), false);
});

test("clean removes local config and generated Hermes settings", () => {
  const home = tempHome();
  const hermesHome = path.join(home, "hermes");
  const setup = run(["setup", "--api-key", "sk-test"], {
    NODUS_WECHAT_HOME: home,
    NODUS_HERMES_HOME: hermesHome,
  });
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(fs.existsSync(path.join(home, "config.json")), true);
  assert.equal(fs.existsSync(path.join(hermesHome, "config.yaml")), true);
  assert.equal(fs.existsSync(path.join(hermesHome, ".env")), true);

  const result = run(["clean", "--yes"], { NODUS_WECHAT_HOME: home, NODUS_HERMES_HOME: hermesHome });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Hermes config: removed/);
  assert.match(result.stdout, /Hermes env: removed/);
  assert.equal(fs.existsSync(path.join(home, "config.json")), false);
  assert.equal(fs.existsSync(path.join(hermesHome, "config.yaml")), false);
  assert.equal(fs.existsSync(path.join(hermesHome, ".env")), false);
});
