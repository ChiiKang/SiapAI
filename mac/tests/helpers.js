"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CLI = path.join(__dirname, "..", "dist", "cli.js");

// Runs the wrapper around a command, optionally feeding stdin lines, and
// resolves with { code, stdout, stderr, log } once it exits. `home` becomes
// AGENT_READY_HOME (session logs + config.json live there).
function runWrapper({ args, steps = [], env = {}, home }) {
  return new Promise((resolve, reject) => {
    const homeDir =
      home ?? fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, AGENT_READY_HOME: homeDir, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    if (steps.length > 0) {
      child.stdin.write(steps.map((s) => s + "\n").join(""));
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`wrapper timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      );
    }, 15000);

    child.on("exit", (code) => {
      clearTimeout(timer);
      const logDir = path.join(homeDir, "sessions");
      const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
      const log =
        logFiles.length > 0
          ? fs.readFileSync(path.join(logDir, logFiles[0]), "utf8")
          : "";
      resolve({ code, stdout, stderr, log, home: homeDir });
    });
  });
}

function count(haystack, regex) {
  return (haystack.match(regex) ?? []).length;
}

module.exports = { runWrapper, count, CLI };
