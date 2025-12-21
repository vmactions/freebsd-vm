
const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const workingDir = __dirname;

// Helper to expand shell-style variables
function expandVars(str, env) {
  if (!str) {
    return str;
  }
  return str.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return env[key] || match;
  }).replace(/\$([a-zA-Z0-9_]+)/g, (match, key) => {
    return env[key] || match;
  });
}

// Parse shell-style config file
function parseConfig(filePath, initialEnv = {}) {
  if (!fs.existsSync(filePath)) {
    return initialEnv;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const env = { ...initialEnv };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Simple shell variable assignment parsing: KEY="VALUE" or KEY=VALUE
    const match = trimmed.match(/^([a-zA-Z0-9_]+)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];
      // Remove wrapping quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Expand variables based on current env
      value = expandVars(value, env);
      env[key] = value;
    }
  }
  return env;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    core.info(`Downloading ${url} to ${dest}`);
    const file = fs.createWriteStream(dest);

    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        if (response.headers.location) {
          core.info(`Redirecting to ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
          });
          return;
        }
      }

      if (response.statusCode !== 200) {
        fs.unlink(dest, () => { });
        reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
        return;
      }

      response.pipe(file);
    };

    const request = https.get(url, handleResponse);

    request.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });

    file.on('finish', () => {
      file.close(() => resolve());
    });

    file.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

async function execSSH(cmd, sshConfig, ignoreReturn = false) {
  core.info(`Exec SSH: ${cmd}`);

  // Standard options for CI/CD
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ];

  // We assume the Host is the OS name (e.g. 'openbsd'), configured in ~/.ssh/config or by anyvm.py
  const host = sshConfig.host;

  try {
    // Pipe command to sh stdin to avoid escaping issues and support multi-line commands
    await exec.exec("ssh", [...args, host, "sh"], {
      input: Buffer.from(cmd)
    });
  } catch (err) {
    if (!ignoreReturn) {
      throw err;
    }
  }
}

async function install() {
  core.info("Installing dependencies...");
  if (process.platform === 'linux') {
    await exec.exec("sudo", ["apt-get", "update"]);
    await exec.exec("sudo", ["apt-get", "install", "-y"
      , "qemu-system-x86"
      , "qemu-system-arm"
      , "qemu-efi-aarch64"
      , "nfs-kernel-server"
      , "rsync"
      , "zstd"
      , "ovmf"
      , "xz-utils"
      , "openssh-server"
      , "qemu-utils"]);
    if (fs.existsSync('/dev/kvm')) {
      await exec.exec("sudo", ["chmod", "666", "/dev/kvm"]);
    }
  } else if (process.platform === 'darwin') {
    await exec.exec("brew", ["install", "qemu"]);
  } else if (process.platform === 'win32') {
    await exec.exec("choco", ["install", "qemu", "-y"]);
  }
}


async function scpToVM(sshHost) {
  const destDir = path.join(process.env["HOME"], "work"); //$HOME/work

  core.info(`==> Ensuring ${destDir} exists...`);
  await execSSH(`mkdir -p ${destDir}`, { host: sshHost });

  core.info("==> Uploading files via scp (excluding _actions and _PipelineMapping)...");

  const items = await fs.promises.readdir(destDir, { withFileTypes: true });

  for (const item of items) {
    const itemName = item.name;
    if (itemName === "_actions" || itemName === "_PipelineMapping") {
      continue;
    }

    const localPath = path.join(destDir, itemName);
    const scpArgs = [
      "-O",
      "-r",
      "-p",
      "-o", "StrictHostKeyChecking=no",
      localPath,
      `${sshHost}:${destDir}/`
    ];

    core.info(`Uploading: ${localPath} to ${sshHost}:${destDir}/`);
    await exec.exec("scp", scpArgs);
  }

  core.info("==> Done.");
}

async function main() {
  try {
    // 1. Inputs
    const debug = core.getInput("debug");
    const releaseInput = core.getInput("release").toLowerCase();
    const archInput = core.getInput("arch").toLowerCase();
    const inputOsName = core.getInput("osname").toLowerCase();
    const mem = core.getInput("mem");
    const cpu = core.getInput("cpu");
    const nat = core.getInput("nat");
    const envs = core.getInput("envs");
    const prepare = core.getInput("prepare");
    const run = core.getInput("run");
    const sync = core.getInput("sync").toLowerCase() || 'rsync';
    const copyback = core.getInput("copyback").toLowerCase();

    // 2. Load Config
    let env = {};
    // Defaults
    env = parseConfig(path.join(__dirname, 'conf/default.release.conf'), env);

    let release = releaseInput || env['DEFAULT_RELEASE'];
    let arch = archInput;

    // Handle Arch logic
    if (!arch) {
      // x86_64 implict
    } else if (arch === 'arm64') {
      arch = 'aarch64';
    } else if (arch === 'x86_64' || arch === 'amd64') {
      arch = '';
    }


    // Load specific conf files
    let confName = release;
    if (arch) confName += `-${arch}`;
    const confPath = path.join(__dirname, `conf/${confName}.conf`);

    if (!fs.existsSync(confPath)) {
      // Attempt to look for base config if arch specific not found? fails if not found.
      throw new Error(`Config not found: ${confPath}`);
    }

    env = parseConfig(confPath, env);

    const anyvmVersion = env['ANYVM_VERSION'];
    const builderVersion = env['BUILDER_VERSION'];
    const osName = inputOsName;

    core.info(`Using ANYVM_VERSION: ${anyvmVersion}`);
    core.info(`Using BUILDER_VERSION: ${builderVersion}`);
    core.info(`Target OS: ${osName}, Release: ${release}`);



    // 3. Download anyvm.py
    if (!anyvmVersion) {
      throw new Error("ANYVM_VERSION not defined in config");
    }
    const anyvmUrl = `https://raw.githubusercontent.com/anyvm-org/anyvm/v${anyvmVersion}/anyvm.py`;
    const anyvmPath = path.join(__dirname, 'anyvm.py');
    await downloadFile(anyvmUrl, anyvmPath);

    core.startGroup("Installing dependencies");
    await install();
    core.endGroup();

    // 4. Start VM
    // Params mapping:
    // anyvm.py --os <os> --release <release> --builder <builder> ... -d
    let args = [anyvmPath, "--os", osName, "--release", release];

    const datadir = path.join(__dirname, 'output');
    if (!fs.existsSync(datadir)) {
      fs.mkdirSync(datadir, { recursive: true });
    }
    args.push("--data-dir", datadir);

    if (builderVersion) {
      args.push("--builder", builderVersion);
    }

    if (debug === 'true') {
      args.push("--debug");
    }

    if (cpu) {
      args.push("--cpu", cpu);
    }
    if (mem) {
      args.push("--mem", mem);
    }
    if (nat) {
      const natLines = nat.split('\n');
      for (const line of natLines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        // Remove quotes and spaces from the line: "8080": "80" -> 8080:80
        const cleanNat = trimmed.replace(/['"\s]/g, '');
        args.push("-p", cleanNat);
      }
    }

    let isScpOrRsync = false;
    if (sync) {
      if (process.platform !== 'win32') {
        const homeDir = process.env.HOME;
        if (homeDir) {
          try {
            core.info(`Setting permissions for ${homeDir}...`);
            fs.chmodSync(homeDir, '755');
          } catch (err) {
            core.warning(`Failed to chmod ${homeDir}: ${err.message}`);
          }
        }
      }
      if (sync === 'scp' || sync === 'rsync') {
        //we will sync later
        isScpOrRsync = true;
      } else {
        args.push("--sync", sync);
        args.push("-v", path.join(process.env["HOME"], "work") + ":" + path.join(process.env["HOME"], "work"));
      }
    }


    args.push("-d"); // Background/daemon

    let sshHost = osName;
    args.push("--ssh-name", sshHost);

    core.startGroup("Starting VM with anyvm.org");
    let output = "";
    const options = {
      listeners: {
        stdout: (data) => {
          output += data.toString();
        }
      }
    };
    await exec.exec("python3", args, options);
    core.endGroup();

    // SSH Env Config
    const sshDir = path.join(process.env["HOME"], ".ssh");
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true });
    }
    const sshConfigPath = path.join(sshDir, "config");

    let sendEnvs = [];
    if (envs) {
      sendEnvs.push(envs);
    }
    // Add GITHUB_* wildcard
    sendEnvs.push("GITHUB_*");
    sendEnvs.push("CI");

    if (sendEnvs.length > 0) {
      fs.appendFileSync(sshConfigPath, `Host ${sshHost}\n  SendEnv ${sendEnvs.join(" ")}\n`);
    }

    //support Custom shell
    const localBinDir = path.join(process.env["HOME"], ".local", "bin");
    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }

    const sshWrapperPath = path.join(localBinDir, sshHost);
    const sshWrapperContent = `#!/usr/bin/env sh\n\nssh ${sshHost} sh<$1\n`;
    fs.writeFileSync(sshWrapperPath, sshWrapperContent);
    fs.chmodSync(sshWrapperPath, '755');



    const work = path.join(process.env["HOME"], "work");
    const vmWork = path.join(process.env["HOME"], "work");

    if (isScpOrRsync) {
      core.startGroup("Syncing source code to VM");
      // Install rsync in VM if needed
      if (sync !== 'scp') {
        core.info("Installing rsync in VM...");
        if (osName.includes('netbsd')) {
          await execSSH("/usr/sbin/pkg_add rsync", { host: sshHost }, true);
        }
      }

      await execSSH(`rm -rf ${vmWork}`, { host: sshHost });
      await execSSH(`mkdir -p ${vmWork}`, { host: sshHost });
      if (sync === 'scp') {
        core.info("Syncing via SCP");
        await scpToVM(sshHost);
      } else {
        core.info("Syncing via Rsync");
        await exec.exec("rsync", ["-avrtopg", "--exclude", "_actions", "--exclude", "_PipelineMapping", "-e", "ssh", work + "/", `${sshHost}:${vmWork}/`]);
        if (debug) {
          core.startGroup("Debug: Checking VM work directory content");
          await execSSH(`tree -L 2 ${vmWork}`, { host: sshHost });
          core.endGroup();
        }
      }
      core.endGroup();
    }
    if (sync !== 'no') {
      await execSSH(`ln -s ${vmWork} $HOME/work`, { host: sshHost });
    }
    core.startGroup("Run 'prepare' in VM");
    if (prepare) {
      await execSSH(prepare, { host: sshHost });
    }
    core.endGroup();

    core.startGroup("Run 'run' in VM");
    if (run) {
      await execSSH(run, { host: sshHost });
    }
    core.endGroup();

    // 7. Copyback
    if (copyback !== 'false' && sync !== 'no' && sync !== 'sshfs' && sync !== 'nfs') {
      const workspace = process.env['GITHUB_WORKSPACE'];
      if (workspace) {
        core.info("Copying back artifacts");
        if (sync === 'scp') {
          const remoteTarCmd = `cd "${work}" && find . -name .git -prune -o -print | cpio -o -H ustar`;
          core.info(`Exec SSH: ${remoteTarCmd}`);

          await new Promise((resolve, reject) => {
            const sshProc = spawn("ssh", ["-o", "StrictHostKeyChecking=no", sshHost, remoteTarCmd]);
            const tarProc = spawn("tar", ["-xf", "-"], { cwd: work });

            sshProc.stdout.pipe(tarProc.stdin);

            // Handle parsing loop of stderr if needed, or just pipe to process.stderr
            sshProc.stderr.on('data', (data) => core.info(`[SSH STDERR] ${data}`));
            tarProc.stderr.on('data', (data) => core.info(`[TAR STDERR] ${data}`));

            sshProc.on('close', (code) => {
              if (code !== 0) reject(new Error(`SSH exited with code ${code}`));
            });

            tarProc.on('close', (code) => {
              if (code !== 0) reject(new Error(`Tar exited with code ${code}`));
              else resolve();
            });

            sshProc.on('error', reject);
            tarProc.on('error', reject);
          });
        } else {
          await exec.exec("rsync", ["-av", "--exclude", ".git", "--exclude", "node_modules", "--exclude", "target", "-e", "ssh", `${sshHost}:${vmWork}/`, `${work}/`]);
        }
      }
    }

  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
