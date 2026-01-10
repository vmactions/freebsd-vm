
const core = require('@actions/core');
const exec = require('@actions/exec');
const cache = require('@actions/cache');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const crypto = require('crypto');

const workingDir = __dirname;

// Check if anyvm.py supports --cache-dir (>=0.1.4)
function isAnyvmCacheSupported(version) {
  if (!version) return false;
  const parts = version.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  // patch part may contain suffix, parseInt will ignore after first non-digit
  const patch = parseInt((parts[2] || '0'), 10) || 0;
  if (major > 0) return true;
  if (major === 0 && minor > 1) return true;
  if (major === 0 && minor === 1 && patch >= 4) return true;
  return false;
}

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

async function execSSH(cmd, sshConfig, ignoreReturn = false, silent = false) {
  core.info(`Exec SSH: ${cmd}`);

  const sshHost = sshConfig.host;
  const osName = sshConfig.osName;
  const work = sshConfig.work;
  const vmwork = sshConfig.vmwork;

  // Standard options for CI/CD
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ];

  let envExports = "";
  if (osName === 'haiku' && work && vmwork) {
    const workRegex = new RegExp(work.replace(/\\/g, '\\\\'), 'gi');
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GITHUB_') || key === 'CI' || key === 'MYTOKEN' || key === 'MYTOKEN2') {
        const val = process.env[key] || "";
        const newVal = val.replace(workRegex, vmwork);
        envExports += `export ${key}="${newVal}"\n`;
      }
    }
  }

  try {
    // Pipe prefix exports + command to sh stdin
    const fullCmd = envExports + cmd;
    await exec.exec("ssh", [...args, sshHost, "sh"], {
      input: Buffer.from(fullCmd),
      silent: silent
    });
  } catch (err) {
    if (!ignoreReturn) {
      throw err;
    }
  }
}

async function install(arch, sync, builderVersion, debug) {
  const start = Date.now();
  core.info("Installing dependencies...");
  if (process.platform === 'linux') {
    const pkgs = [
      "qemu-utils"
    ];

    if (!arch || arch === 'x86_64' || arch === 'amd64') {
      pkgs.push("qemu-system-x86", "ovmf");
    } else if (arch === 'aarch64' || arch === 'arm64') {
      pkgs.push("qemu-system-arm", "qemu-efi-aarch64", "ipxe-qemu");
    } else {
      pkgs.push("qemu-system-misc", "u-boot-qemu", "ipxe-qemu");
    }

    if (sync === 'nfs') {
      pkgs.push("nfs-kernel-server");
    }
    if (sync === 'rsync') {
      let rsyncRequired = true;
      if (builderVersion) {
        const parts = builderVersion.split('.');
        const major = parseInt(parts[0], 10) || 0;
        if (major >= 2) {
          rsyncRequired = false;
        }
      }

      if (rsyncRequired) {
        pkgs.push("rsync");
      }
    }

    const aptOpts = [
      "-o", "Acquire::Retries=3",
      "-o", "Dpkg::Options::=--force-confdef",
      "-o", "Dpkg::Options::=--force-confold",
      "-o", "Dpkg::Options::=--force-unsafe-io",
      "-o", "Acquire::Languages=none",
    ];

    const aptCacheDir = path.join(os.homedir(), ".apt-cache");
    if (!fs.existsSync(aptCacheDir)) {
      fs.mkdirSync(aptCacheDir, { recursive: true });
    }

    const osVersion = process.env.ImageOS || os.release();
    const osArch = process.arch;
    const hash = crypto.createHash('md5').update(pkgs.sort().join(',')).digest('hex');
    const aptCacheKey = `apt-pkgs-${process.platform}-${osVersion}-${osArch}-${hash}`;
    let restoredKey = null;

    try {
      restoredKey = await cache.restoreCache([aptCacheDir], aptCacheKey);
      if (restoredKey) {
        core.info(`Restored apt packages from cache: ${restoredKey}`);
        await exec.exec("sudo", ["cp", "-rp", `${aptCacheDir}/.`, "/var/cache/apt/archives/"], { silent: true });
      }
    } catch (e) {
      core.warning(`Apt cache restore failed: ${e.message}`);
    }

    // 1. Update with quiet mode
    await exec.exec("sudo", ["apt-get", "update", "-q"], { silent: true });

    // 2. Install the packages
    await exec.exec("sudo", ["apt-get", "install", "-y", "-q", ...aptOpts, "--no-install-recommends", ...pkgs]);

    // 3. Save cache
    try {
      if (!restoredKey) {
        // Copy newly downloaded files back to our local cache dir
        await exec.exec("sh", ["-c", `cp -rp /var/cache/apt/archives/*.deb ${aptCacheDir}/ || true`], { silent: true });
        if (fs.readdirSync(aptCacheDir).length > 0) {
          await cache.saveCache([aptCacheDir], aptCacheKey);
          core.info(`Saved apt packages to cache: ${aptCacheKey}`);
        }
      }
    } catch (e) {
      core.warning(`Apt cache save failed: ${e.message}`);
    }

    if (fs.existsSync('/dev/kvm')) {
      await exec.exec("sudo", ["chmod", "666", "/dev/kvm"]);
    }
  } else if (process.platform === 'darwin') {
    await exec.exec("brew", ["install", "qemu"]);
  } else if (process.platform === 'win32') {
    await exec.exec("choco", ["install", "qemu", "-y"]);
  }

  if (debug === 'true') {
    const elapsed = Date.now() - start;
    core.info(`install() took ${elapsed}ms`);
  }
}


async function scpToVM(sshHost, work, vmwork, osName) {
  core.info(`==> Ensuring ${vmwork} exists...`);
  await execSSH(`mkdir -p ${vmwork}`, { host: sshHost, osName, work, vmwork });

  core.info("==> Uploading files via scp (excluding _actions and _PipelineMapping)...");

  const items = await fs.promises.readdir(work, { withFileTypes: true });

  for (const item of items) {
    const itemName = item.name;
    if (itemName === "_actions" || itemName === "_PipelineMapping") {
      continue;
    }

    const localPath = path.join(work, itemName);
    const scpArgs = [
      "-O",
      "-r",
      "-p",
      "-o", "StrictHostKeyChecking=no",
      localPath,
      `${sshHost}:${vmwork}/`
    ];

    core.info(`Uploading: ${localPath} to ${sshHost}:${vmwork}/`);
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
    const syncTime = core.getInput("sync-time").toLowerCase();

    const work = path.join(process.env["HOME"], "work");
    let vmwork = path.join(process.env["HOME"], "work");
    if (inputOsName === 'haiku') {
      vmwork = `/boot/home/${os.userInfo().username}/work`;
    }

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
    await install(arch, sync, builderVersion, debug);
    core.endGroup();

    // 4. Start VM
    // Params mapping:
    // anyvm.py --os <os> --release <release> --builder <builder> ... -d
    let args = [anyvmPath, "--os", osName, "--release", release];

    // Pass arch to anyvm if specified
    if (arch) {
      args.push("--arch", arch);
    }

    // Support configurable data dir; cache dir is what anyvm uses to store artifacts
    const dataDirInput = core.getInput("data-dir") || '';
    const datadir = dataDirInput ? expandVars(dataDirInput, process.env) : path.join(__dirname, 'output');
    if (!fs.existsSync(datadir)) {
      fs.mkdirSync(datadir, { recursive: true });
    }
    args.push("--data-dir", datadir);

    // cacheDir is what we restore/save via @actions/cache and pass to anyvm.py --cache-dir (>=0.1.4)
    const cacheSupported = isAnyvmCacheSupported(anyvmVersion);
    const cacheDirInput = core.getInput("cache-dir") || '';
    let cacheDir;
    const archForKey = arch || (process.arch === 'x64' ? 'amd64' : process.arch);
    const cacheKey = `${osName}-${release}-${builderVersion || 'default'}-${archForKey}-v1`;
    const restoreKeys = [cacheKey];
    let restoredKey = null;

    if (cacheSupported) {
      cacheDir = cacheDirInput ? expandVars(cacheDirInput, process.env) : path.join(os.tmpdir(), cacheKey);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      try {
        const restoreStart = Date.now();
        restoredKey = await cache.restoreCache([cacheDir], cacheKey, restoreKeys);
        const restoreElapsed = Date.now() - restoreStart;
        core.info(`cache.restoreCache() took ${restoreElapsed}ms`);
        if (restoredKey) {
          core.info(`Cache restored: ${restoredKey}`);
        } else {
          core.info('No cache hit for VM cache directory');
        }
      } catch (e) {
        core.warning(`Cache restore failed: ${e.message}`);
      }

      // Pass cache dir to anyvm
      args.push("--cache-dir", cacheDir);
    } else {
      core.info(`anyvm cache-dir not supported for version ${anyvmVersion}, skip cache.`);
    }

    if (builderVersion) {
      args.push("--builder", builderVersion);
    }

    if (syncTime === 'true') {
      args.push("--sync-time");
    } else if (syncTime === 'false') {
      args.push("--sync-time", "off");
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
        args.push("-v", `${work}:${vmwork}`);
      }
    }


    args.push("-d"); // Background/daemon

    let sshHost = osName;
    args.push("--ssh-name", sshHost);

    args.push("--snapshot");
    if (osName === 'haiku') {
      args.push("--vga", "std");
    }
    args.push("--vnc", "off");

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

    // Save cache for anyvm cache directory immediately after VM start/prepare
    if (cacheSupported) {
      if (debug === 'true' && cacheDir && fs.existsSync(cacheDir)) {
        core.startGroup('Cache dir preview (debug)');
        try {
          await exec.exec('du', ['-sh', cacheDir]);
          await exec.exec('find', [cacheDir, '-maxdepth', '5', '-type', 'f']);
        } catch (e) {
          core.warning(`Listing cache dir failed: ${e.message}`);
        }
        core.endGroup();
      }
      try {
        if (!restoredKey && cacheDir && fs.existsSync(cacheDir)) {
          await cache.saveCache([cacheDir], cacheKey);
          core.info(`Cache saved: ${cacheKey}`);
        } else {
          core.info('Skip cache save (cache was restored or directory missing)');
        }
      } catch (e) {
        core.warning(`Cache save skipped: ${e.message}`);
      }
    }

    const sshDir = path.join(process.env["HOME"], ".ssh");
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true });
    }
    const sshConfigPath = path.join(sshDir, "config");

    let sendEnvs = [];
    if (envs) {
      sendEnvs.push(envs);
    }
    // Only use wildcard GITHUB_* if not on Haiku (since we use injection on Haiku)
    if (osName !== 'haiku') {
      sendEnvs.push("GITHUB_*");
    }
    sendEnvs.push("CI");

    if (sendEnvs.length > 0) {
      fs.appendFileSync(sshConfigPath, `Host ${sshHost}\n  SendEnv ${sendEnvs.join(" ")}\n`);
    }

    fs.appendFileSync(sshConfigPath, "Host *\n  StrictHostKeyChecking no\n");
    if (debug) {
      core.info("SSH config content:");
      core.info(fs.readFileSync(sshConfigPath, "utf8"));
    }

    const sshConfig = {
      host: sshHost,
      osName: osName,
      work: work,
      vmwork: vmwork
    };

    //support Custom shell
    const localBinDir = path.join(process.env["HOME"], ".local", "bin");
    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }

    const sshWrapperPath = path.join(localBinDir, sshHost);
    const sshWrapperContent = `#!/usr/bin/env sh\n\nssh ${sshHost} sh<$1\n`;
    fs.writeFileSync(sshWrapperPath, sshWrapperContent);
    fs.chmodSync(sshWrapperPath, '755');

    const onStartedHook = path.join(__dirname, 'hooks', 'onStarted.sh');
    if (fs.existsSync(onStartedHook)) {
      core.info(`Running onStarted hook: ${onStartedHook}`);
      const hookContent = fs.readFileSync(onStartedHook, 'utf8');
      await execSSH(hookContent, sshConfig, false, debug !== 'true');
    }

    if (isScpOrRsync) {
      core.startGroup("Syncing source code to VM");
      // Install rsync in VM if needed
      if (sync !== 'scp') {
        core.info("Installing rsync in VM...");
        if (osName.includes('netbsd')) {
          await execSSH("/usr/sbin/pkg_add rsync", { ...sshConfig }, true);
        }
      }

      await execSSH(`rm -rf ${vmwork}`, { ...sshConfig });
      await execSSH(`mkdir -p ${vmwork}`, { ...sshConfig });
      if (sync === 'scp') {
        core.info("Syncing via SCP");
        await scpToVM(sshHost, work, vmwork, osName);
      } else {
        core.info("Syncing via Rsync");
        await exec.exec("rsync", ["-avrtopg", "--exclude", "_actions", "--exclude", "_PipelineMapping", "-e", "ssh", work + "/", `${sshHost}:${vmwork}/`]);
        if (debug) {
          core.startGroup("Debug: Checking VM work directory content");
          await execSSH(`tree -L 2 ${vmwork}`, { ...sshConfig });
          core.endGroup();
        }
      }
      core.endGroup();
    }
    if (sync !== 'no') {
      await execSSH(`ln -s ${vmwork} $HOME/work`, { ...sshConfig });
    }
    core.startGroup("Run 'prepare' in VM");
    if (prepare) {
      const prepareCmd = (sync !== 'no') ? `cd "$GITHUB_WORKSPACE"\n${prepare}` : prepare;
      await execSSH(prepareCmd, { ...sshConfig });
    }
    core.endGroup();

    core.startGroup("Run 'run' in VM");
    if (run) {
      const runCmd = (sync !== 'no') ? `cd "$GITHUB_WORKSPACE"\n${run}` : run;
      await execSSH(runCmd, { ...sshConfig });
    }
    core.endGroup();

    // 7. Copyback
    if (copyback !== 'false' && sync !== 'no' && sync !== 'sshfs' && sync !== 'nfs') {
      const workspace = process.env['GITHUB_WORKSPACE'];
      if (workspace) {
        core.info("Copying back artifacts");
        if (sync === 'scp') {
          let useCpio = true;
          if (osName === 'haiku') {
            try {
              await execSSH("command -v cpio", sshConfig);
            } catch (e) {
              useCpio = false;
            }
          }

          const remoteTarCmd = useCpio
            ? `cd "${vmwork}" && find . -name .git -prune -o -print | cpio -o -H ustar`
            : `cd "${vmwork}" && tar -cf - --exclude .git .`;

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
          await exec.exec("rsync", ["-av", "--exclude", ".git", "-e", "ssh", `${sshHost}:${vmwork}/`, `${work}/`]);
        }
      }
    }

  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
