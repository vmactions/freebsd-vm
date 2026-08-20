
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as cache from '@actions/cache';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backgroundPromises = [];
let activeBackgroundTasks = 0;

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

// Check if anyvm.py supports the 'sys-nfs' sync method (>=0.4.9). Older
// versions don't know that argument, so we must keep using plain 'nfs'.
function isAnyvmSysNfsSupported(version) {
  if (!version) return false;
  const parts = version.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt((parts[2] || '0'), 10) || 0;
  if (major > 0) return true;
  if (major === 0 && minor > 4) return true;
  if (major === 0 && minor === 4 && patch >= 9) return true;
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

// The conf file of a non-x86_64 build is "<release>-<arch>.conf", so the arch
// suffixes have to be known to tell them apart from a release name that just
// carries a dash of its own: GhostBSD ships "26.1-xfce", Solaris "11.4-gcc-14",
// OmniOS "r151058-build". Keep in sync with ARCHES in
// .github/tpl/generate.tpl.yml, the arch matrix in .github/tpl/test.tpl.yml,
// and the two arch regexes in bump.py.
const CONF_ARCHES = [
  "aarch64", "riscv64", "powerpc64", "sparc64", "ppc64le", "s390x", "i386", "loongarch64"
];

// Split one release component into the pieces a human compares: runs of digits
// and runs of everything else, so "10" sorts after "9" and "-SP5" after "-SP4".
function releaseChunks(part) {
  return part.match(/\d+|\D+/g) || [];
}

// Compare a single dot separated component of two release names.
function compareReleaseParts(a, b) {
  const ca = releaseChunks(a);
  const cb = releaseChunks(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i];
    const y = cb[i];
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const nx = parseInt(x, 10);
      const ny = parseInt(y, 10);
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x.toLowerCase() !== y.toLowerCase()) {
      return x.toLowerCase() < y.toLowerCase() ? -1 : 1;
    }
  }
  // Equal so far: the one WITHOUT the extra pieces wins. A trailing suffix is a
  // flavor, not a newer version -- "26.1" is the plain GhostBSD release and
  // "26.1-xfce" a variant of it, so "release: 26" has to pick "26.1".
  if (ca.length !== cb.length) return ca.length < cb.length ? 1 : -1;
  return 0;
}

// Compare two release names, oldest first. A release name is not always a
// number: openEuler ships "24.03-LTS-SP4", Haiku "r1beta5", Tribblix "0m40".
function compareReleaseNames(a, b) {
  const pa = a.split('.');
  const pb = b.split('.');
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const c = compareReleaseParts(pa[i], pb[i]);
    if (c !== 0) return c;
  }
  // More components = more specific = newer ("6.4.2" after "6.4").
  if (pa.length !== pb.length) return pa.length < pb.length ? -1 : 1;
  return 0;
}

// Every release this repo ships a conf for, for one arch, oldest first.
// Each entry is { release, confName }: for x86_64 they are the same, for any
// other arch confName is "<release>-<arch>".
function listConfReleases(confDir, arch) {
  const archSuffix = arch ? `-${arch.toLowerCase()}` : '';
  const found = [];
  for (const file of fs.readdirSync(confDir)) {
    if (!file.endsWith('.conf')) continue;
    const name = file.slice(0, -'.conf'.length);
    if (name === 'default.release') continue;
    const lower = name.toLowerCase();
    if (arch) {
      if (!lower.endsWith(archSuffix)) continue;
      found.push({ release: name.slice(0, -archSuffix.length), confName: name });
    } else {
      // conf/<release>.conf is the x86_64 one, so every other arch is out.
      if (CONF_ARCHES.some((a) => lower.endsWith(`-${a}`))) continue;
      found.push({ release: name, confName: name });
    }
  }
  return found
    .filter((r) => r.release)
    .sort((x, y) => compareReleaseNames(x.release, y.release));
}

// Resolve a partial release -- "14" -> the newest 14.x, "14.3" -> the newest
// 14.3.x -- to the release it stands for. The number of components is not
// fixed ("6.4.2", "14.3", "24.03-LTS-SP4"), but all releases of one VM have the
// same shape, so a shorter input can only be a leading part of a full name.
// Every component given must match in full: "14" picks 14.4 but never 140.x,
// and "13.4" never falls through to 13.5. Returns null when nothing matches.
function resolveReleasePrefix(confDir, prefix, arch) {
  const wanted = prefix.toLowerCase().split('.');
  let best = null;
  for (const item of listConfReleases(confDir, arch)) {
    const parts = item.release.split('.');
    if (parts.length < wanted.length) continue;
    if (wanted.some((w, i) => parts[i].toLowerCase() !== w)) continue;
    if (!best || compareReleaseNames(best.release, item.release) < 0) {
      best = item;
    }
  }
  return best;
}

function downloadFileOnce(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      file.destroy();
      fs.unlink(dest, () => { });
      reject(err);
    };

    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        if (response.headers.location) {
          core.info(`Redirecting to ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', fail);
          return;
        }
      }

      if (response.statusCode !== 200) {
        fail(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
        return;
      }

      // A socket reset mid-body errors on the response stream, not the
      // request; without this the file never 'finish'es and we hang forever.
      response.on('error', fail);
      response.pipe(file);
    };

    https.get(url, handleResponse).on('error', fail);

    file.on('finish', () => {
      if (settled) return;
      settled = true;
      file.close(() => resolve());
    });

    file.on('error', fail);
  });
}

// Transient network errors (e.g. `read ECONNRESET` from raw.githubusercontent.com,
// which killed freebsd-vm run 29292440869) should not fail the whole job:
// retry a few times with a short growing backoff before giving up.
async function downloadFile(url, dest, retries = 4) {
  core.info(`Downloading ${url} to ${dest}`);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await downloadFileOnce(url, dest);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delayMs = 3000 * (attempt + 1);
        core.warning(`Download failed: ${err.message}, retrying in ${delayMs / 1000}s (${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// Run `ssh ... sh` once, piping `input` to its stdin. Returns the exit code.
// If timeoutMs > 0 and the ssh process has not exited by then, it is killed
// (SIGTERM, then SIGKILL after a short grace) and the promise rejects with a
// timeout error. We spawn directly instead of using exec.exec() because
// @actions/exec 1.1.1 silently ignores the AbortSignal option, so it cannot
// interrupt a wedged ssh session (observed: Haiku ssh occasionally prints its
// output but never tears down the channel, hanging the job for the GHA 6h max;
// see haiku-vm run 71585652274).
function runSSHOnce(args, sshHost, input, silent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...args, sshHost, "sh"], { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let timedOut = false;
    let overallTimer = null;
    let killTimer = null;

    const cleanup = () => {
      if (overallTimer) clearTimeout(overallTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    if (timeoutMs > 0) {
      overallTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch (e) { /* already gone */ }
        // Escalate if ssh does not die promptly.
        killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) { /* already gone */ } }, 5000);
      }, timeoutMs);
    }

    child.stdout.on("data", (d) => { if (!silent) process.stdout.write(d); });
    child.stderr.on("data", (d) => { if (!silent) process.stderr.write(d); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        reject(new Error(`ssh timed out after ${timeoutMs}ms`));
      } else {
        resolve(code == null ? 1 : code);
      }
    });

    // Feed the command script to ssh stdin and close it so the remote sh sees EOF.
    child.stdin.on("error", () => { /* ignore EPIPE if ssh already exited */ });
    child.stdin.write(input);
    child.stdin.end();
  });
}

async function execSSH(cmd, sshConfig, ignoreReturn = false, silent = false, options = {}) {
  core.info(`Exec SSH: ${cmd}`);

  const sshHost = sshConfig.host;
  const osName = sshConfig.osName;
  const work = sshConfig.work;
  const vmwork = sshConfig.vmwork;
  // timeoutMs: kill the ssh child if it has not finished after this many ms (0 = no timeout).
  // retries:   number of additional attempts on timeout / failure (0 = no retry).
  // Use these only for internal/idempotent commands -- user-supplied run/prepare scripts
  // can legitimately run for hours, so leave them at the defaults (unbounded, no retry).
  const timeoutMs = options.timeoutMs || 0;
  const retries = Math.max(0, options.retries || 0);

  // Standard options for CI/CD
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
  ];

  let envExports = "";
  if ((osName === 'haiku' || osName === 'blissos') && work && vmwork) {
    const workRegex = new RegExp(work.replace(/\\/g, '\\\\'), 'gi');
    const envNames = (sshConfig.envs || '').split(/\s+/).filter(Boolean);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GITHUB_') || key === 'CI' || envNames.includes(key)) {
        const val = process.env[key] || "";
        const newVal = val.replace(workRegex, vmwork).replace(/'/g, "'\\''");
        envExports += `export ${key}='${newVal}'\n`;
      }
    }
  }

  // Pipe prefix exports + command to sh stdin
  const fullCmd = "set -eu\n" + envExports + cmd;
  const input = Buffer.from(fullCmd);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const code = await runSSHOnce(args, sshHost, input, silent, timeoutMs);
      if (code === 0) {
        return;
      }
      lastErr = new Error(`ssh exited with code ${code}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) {
      core.warning(`SSH ${lastErr && lastErr.message}, retrying (${attempt + 1}/${retries})...`);
    }
  }
  if (!ignoreReturn) {
    throw lastErr;
  }
}

// Value for rsync's --rsync-path on the remote.
// We wrap with `sh -c '...'` so the remote login shell (which may be csh on
// FreeBSD/DragonFly root) only sees `sh -c <script> rsync ...` and just exec's
// sh -- the script itself is interpreted by sh (POSIX), so we can safely use
// `PATH=$PATH:... rsync` syntax and let $PATH expand at remote runtime.
// The appended dirs cover BSD pkg (/usr/local/{bin,sbin}), NetBSD pkgsrc
// (/usr/pkg/{bin,sbin}) and Tribblix/MacPorts (/opt/local/{bin,sbin}).
const REMOTE_RSYNC_PATH = `sh -c 'PATH=$PATH:/usr/local/bin:/usr/local/sbin:/usr/pkg/bin:/usr/pkg/sbin:/opt/local/bin:/opt/local/sbin exec rsync "$@"' rsync`;

// Fixed host-side forward of a telnet guest's control channel (guest port
// 23). The telnet guests (ReactOS, Redox, RISC OS) have no sshd; anyvm
// drives them over a baked-in telnet agent, and this action reaches a
// running VM through `anyvm.py --attach --ssh-port <port>`. Runners are
// single-job, so a fixed port cannot collide.
const TELNET_CTRL_PORT = 10023;

// Pinned host port for a 9P guest's file channel (Plan 9). Same reason as
// the control port above: the copyback runs in a SEPARATE anyvm process
// (`--attach --pull-files`) which cannot discover a randomly chosen forward.
const P9_PORT = 20564;

// Run one command in a telnet-transport guest through `anyvm.py --attach`.
// The attach exec is marker-based: it waits until the command actually
// finishes (no fixed read window) and exits with the command's 0/1 status
// where the guest shell can express one; the RISC OS agent has no status
// channel, so there completion always reports 0.
async function execTelnet(cmd, osName, anyvmPath, ignoreReturn = false) {
  core.info(`Exec (telnet): ${cmd}`);
  const rc = await exec.exec("python3", [
    anyvmPath, "--os", osName, "--attach",
    "--ssh-port", String(TELNET_CTRL_PORT), "--", cmd,
  ], { ignoreReturnCode: true });
  if (rc !== 0 && !ignoreReturn) {
    throw new Error(`Guest command failed with exit code ${rc}`);
  }
  return rc;
}

// A multi-line prepare/run script on a telnet guest. cmd.exe (ReactOS) and
// ion (Redox) chain lines with && inside ONE session, which gives the same
// stop-on-first-failure semantics the ssh guests get from `sh -e`-style
// scripts. The RISC OS agent has no operators, so each line goes as its own
// command (its agent gives every line a fresh CLI anyway).
async function execTelnetScript(script, osName, anyvmPath) {
  const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    return;
  }
  if (osName === 'riscos') {
    for (const line of lines) {
      await execTelnet(line, osName, anyvmPath);
    }
  } else {
    await execTelnet(lines.join(' && '), osName, anyvmPath);
  }
}

// In-guest poweroff commands used by cache-after-prepare to shut the VM down
// cleanly before caching the prepared qcow2. Values copied from each
// anyvm-org/<os>-builder conf's VM_SHUTDOWN_CMD (the builders run the same
// command to shut down every image build). A VM_SHUTDOWN_CMD baked into the
// release conf takes precedence over this fallback table.
const SHUTDOWN_CMDS = {
  freebsd: "/sbin/shutdown -p now",
  ghostbsd: "/sbin/shutdown -p now",
  midnightbsd: "/sbin/shutdown -p now",
  dragonflybsd: "/sbin/shutdown -p now",
  netbsd: "/sbin/shutdown -p now",
  openbsd: "/sbin/shutdown -p now",
  solaris: "shutdown -y -i5 -g0",
  omnios: "shutdown -y -i5 -g0",
  openindiana: "shutdown -y -i5 -g0",
  tribblix: "/usr/sbin/poweroff",
  haiku: "shutdown -q",
  blissos: "reboot -p",
  ubuntu: "shutdown -h now",
};

// On GitHub's x86_64 runners only an x86_64/amd64 guest gets KVM acceleration;
// every other guest arch runs under full TCG emulation and is dramatically
// slower (sparc64, riscv64, powerpc64, s390x, aarch64-on-x64, ...). Writing a
// large source tree (e.g. a big node_modules) into such a VM can stall long
// enough that ssh's keepalive declares the server dead mid-transfer
// ("Timeout, server 127.0.0.1 not responding"), killing rsync with a broken
// pipe (exit 255). `arch` is already normalized here: '' means x86_64/amd64.
function isSlowEmulatedArch(arch) {
  return !!arch && arch !== 'x86_64' && arch !== 'amd64';
}

// ssh transport handed to rsync for slow emulated guests: stay connected
// through long stalls instead of giving up after the default keepalive window.
// 30s interval x 60 unanswered probes = ~30 min of grace before disconnecting.
const RSYNC_SSH_SLOW = "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=60 -o ConnectTimeout=120";
// rsync's own I/O timeout (seconds) for slow guests: a defined upper bound
// matching the ssh grace above, so a genuinely wedged sync still fails while a
// slow-but-progressing one is not aborted. Fast (KVM) arches keep rsync's
// default of no --timeout.
const RSYNC_SLOW_TIMEOUT = "1800";

async function handleErrorWithDebug(sshHost, vncLink, debug) {
  const message = vncLink
    ? `Please open the remote vnc link for debugging: ${vncLink} . To finish debugging, you can run \`touch ~/continue\` in the VM. In the VM, you can use \`ssh host\` to access the host.`
    : "Please open the remote vnc link for debugging. To finish debugging, you can run `touch ~/continue` in the VM. In the VM, you can use `ssh host` to access the host.";

  core.warning(message);

  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=3",
    sshHost
  ];

  core.info("Monitoring ~/continue file in the VM...");
  const continueFile = "~/continue";
  let finished = false;
  let counter = 0;
  while (!finished) {
    counter++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      if (debug === 'true') {
        core.info(`[Debug] Checking for ${continueFile} in VM (Attempt ${counter})...`);
      }
      const exitCode = await exec.exec("ssh", [...args, `test -f ${continueFile}`], {
        silent: true,
        ignoreReturnCode: true,
        signal: controller.signal
      });

      if (debug === 'true') {
        core.info(`[Debug] SSH exit code: ${exitCode}`);
      }

      if (exitCode === 0) {
        core.info(`${continueFile} found. Cleaning up and continuing...`);
        await exec.exec("ssh", [...args, `rm -f ${continueFile}`], { silent: true });
        finished = true;
      } else if (exitCode === 1) {
        // File not found, but SSH is fine. Just wait and retry.
        await new Promise(r => setTimeout(r, 5000));
      } else {
        // Any other exit code (like 255) usually means SSH connection failed
        if (debug === 'true') {
          core.info(`[Debug] SSH failed with exit code ${exitCode}. Assuming VM exited.`);
        }
        throw new Error("The VM has exited (SSH connection failed), so the debugging process is terminating.");
      }
    } catch (e) {
      if (debug === 'true') {
        core.info(`[Debug] SSH check threw error: ${e.message}`);
      }
      throw new Error("The VM has exited, so the debugging process is terminating.");
    } finally {
      clearTimeout(timer);
    }
  }
}

async function install(arch, sync, builderVersion, debug, disableCache) {
  const start = Date.now();
  core.info("Installing dependencies...");
  if (process.platform === 'linux') {
    const pkgs = [
      "qemu-utils"
    ];

    if (!arch || arch === 'x86_64' || arch === 'amd64' || arch === 'i386') {
      // qemu-system-x86 ships BOTH qemu-system-x86_64 and qemu-system-i386
      // on Debian/Ubuntu (i386 is the GNU Hurd 2025-i386 guest).
      pkgs.push("qemu-system-x86", "ovmf");
    } else if (arch === 'aarch64' || arch === 'arm64') {
      pkgs.push("qemu-system-arm", "qemu-efi-aarch64", "ipxe-qemu");
    } else {
      // qemu-system-misc covers riscv64 (and the other "misc" targets), but
      // ppc64 / sparc64 / s390x ship in their own packages on Ubuntu. These
      // only *recommend* seabios (which --no-install-recommends skips), unlike
      // qemu-system-x86 which depends on it; install it explicitly so the VGA
      // romfiles (e.g. vgabios-stdvga.bin, used by the pseries default display)
      // are present.
      pkgs.push("qemu-system-misc", "u-boot-qemu", "ipxe-qemu", "seabios");
      if (arch === 'powerpc64' || arch === 'ppc64' || arch === 'ppc64le') {
        pkgs.push("qemu-system-ppc");
      } else if (arch === 'sparc64' || arch === 'sparc') {
        pkgs.push("qemu-system-sparc");
      } else if (arch === 's390x') {
        pkgs.push("qemu-system-s390x");
      }
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

    // 1. Drop apt's needrestart hook. After every install it scans the running
    // processes to report which services want restarting -- measured 3-4.7s on
    // a runner that gets destroyed minutes later. The hook is a single
    // DPkg::Post-Invoke line in this one file, so removing the file is enough.
    // (No point touching man-db: the runner image already ships
    // man-db/auto-update false, so that trigger is a no-op before we start.)
    await exec.exec("sudo", ["rm", "-f", "/etc/apt/apt.conf.d/99needrestart"],
      { silent: true, ignoreReturnCode: true });

    // 2. Restore the .deb files from a previous run into apt's archive cache,
    // so step 3 installs from disk instead of pulling them off the Ubuntu
    // mirror -- the least reliable link in the job (measured: a median 378
    // kB/s for a whole hour on freebsd-vm run 32207630189 attempt 1, worst 14
    // kB/s, one job stuck in apt for 56 minutes).
    //
    // The key carries ImageVersion, so a weekly runner-image rebuild starts a
    // fresh entry rather than serving .debs that no longer match the
    // preinstalled index step 3 resolves against. Even when it does go stale,
    // apt only reuses a cached .deb whose hash matches the index, so the worst
    // case is a partial download, never a wrong install.
    const aptCacheDir = path.join(os.homedir(), ".apt-cache");
    const imageTag = `${process.env.ImageOS || 'linux'}-${process.env.ImageVersion || os.release()}`;
    const pkgsHash = crypto.createHash('md5').update(pkgs.slice().sort().join(',')).digest('hex');
    const aptCacheKey = `apt-pkgs-${process.platform}-${process.arch}-${imageTag}-${pkgsHash}`;
    let aptRestoredKey = null;

    if (!disableCache) {
      try {
        if (!fs.existsSync(aptCacheDir)) {
          fs.mkdirSync(aptCacheDir, { recursive: true });
        }
        aptRestoredKey = await cache.restoreCache([aptCacheDir], aptCacheKey);
        if (aptRestoredKey) {
          core.info(`Restored apt packages from cache: ${aptRestoredKey}`);
          await exec.exec("sudo", ["sh", "-c",
            `cp -p ${aptCacheDir}/*.deb /var/cache/apt/archives/ 2>/dev/null || true`],
            { silent: true, ignoreReturnCode: true });
        }
      } catch (e) {
        core.warning(`Apt cache restore failed: ${e.message}`);
      }
    }

    // 3. Install the packages straight off the preinstalled apt index. The
    // runner image keeps /var/lib/apt/lists (actions/runner-images cleanup.sh
    // only runs 'apt-get clean'), so the index resolves without a refresh and
    // the retry in step 4 stays unused.
    //
    // Measured across all 17 *-vm repos, each against its own pre-change run:
    // install() went from a median 19.9s to 13.4s, improving in 16 of 17. The
    // odd one out (freebsd-vm) hit an hour where the mirror itself was sick.
    // An early worry that skipping the update caused intermittent mirror
    // stalls did NOT survive that wider sample -- sub-1MB/s downloads ran
    // 18/208 BEFORE the change and 9/208 after. The 375 clean pre-change
    // samples that raised the worry were all from one repo.
    const installArgs = ["apt-get", "install", "-y", "-q", ...aptOpts, "--no-install-recommends", ...pkgs];
    const installRc = await exec.exec("sudo", installArgs, { ignoreReturnCode: true });

    // 4. Fall back to a refreshed index and retry. Not silent, and not
    // ignoreReturnCode: a failure here is a real failure.
    if (installRc !== 0) {
      core.info(`apt-get install failed against the preinstalled index (exit ${installRc}); refreshing it and retrying.`);
      await exec.exec("sudo", ["apt-get", "update", "-q"], { silent: true });
      await exec.exec("sudo", installArgs);
    }

    // 5. Save the downloaded .debs for the next run. Only on a miss -- on a hit
    // the entry already holds them and the key is immutable, so re-saving would
    // just burn an upload and log an "already exists" warning. Runs in the
    // background: the VM boot that follows does not depend on it.
    if (!disableCache && !aptRestoredKey) {
      const saveAptCache = async () => {
        activeBackgroundTasks++;
        try {
          // apt-get leaves the .debs behind: Ubuntu's
          // Keep-Downloaded-Packages "0" is scoped to binary::apt::, so it
          // applies to `apt` but not to the `apt-get` above (verified both
          // ways on 24.04).
          if (!fs.existsSync(aptCacheDir)) {
            fs.mkdirSync(aptCacheDir, { recursive: true });
          }
          await exec.exec("sh", ["-c",
            `cp -p /var/cache/apt/archives/*.deb ${aptCacheDir}/ 2>/dev/null || true`],
            { silent: true, ignoreReturnCode: true });
          if (fs.readdirSync(aptCacheDir).some(f => f.endsWith('.deb'))) {
            await cache.saveCache([aptCacheDir], aptCacheKey);
            core.info(`Saved apt packages to cache: ${aptCacheKey}`);
          }
        } catch (e) {
          if (e.message && (e.message.includes('already exists') ||
            e.message.includes('Cache already exists'))) {
            core.info(`Apt cache save skipped (benign): ${e.message}`);
          } else {
            core.warning(`Apt cache save failed: ${e.message}`);
          }
        } finally {
          activeBackgroundTasks--;
        }
      };
      backgroundPromises.push(saveAptCache());
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


// Recursively check whether any file named `name` exists under `dir`.
// Used to decide between fast-path `scp -r` and slow-path file-by-file scp.
async function treeContainsFile(dir, name) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === name) return true;
    if (entry.isDirectory()) {
      if (await treeContainsFile(path.join(dir, entry.name), name)) return true;
    }
  }
  return false;
}

// Recursively scp `localPath` into `remoteDir` on `sshHost`, skipping any entry
// whose basename is in `excludeNames`. Preserves directory structure.
async function scpTreeExcluding(sshHost, localPath, remoteDir, excludeNames, debug, sshConfig) {
  const name = path.basename(localPath);
  if (excludeNames.includes(name)) return;

  let stat;
  try {
    stat = await fs.promises.stat(localPath);
  } catch {
    return;
  }

  if (stat.isFile()) {
    const scpArgs = [
      "-O", "-p",
      "-o", "StrictHostKeyChecking=no",
      localPath,
      `${sshHost}:${remoteDir}/`,
    ];
    if (debug === 'true') {
      core.info(`Uploading: ${localPath} to ${sshHost}:${remoteDir}/`);
    }
    await exec.exec("scp", scpArgs, { silent: debug !== 'true' });
    return;
  }

  if (!stat.isDirectory()) return;

  const remoteSubdir = `${remoteDir}/${name}`;
  await execSSH(`mkdir -p '${remoteSubdir}'`, sshConfig, false, debug !== 'true');

  const entries = await fs.promises.readdir(localPath, { withFileTypes: true });
  for (const entry of entries) {
    await scpTreeExcluding(sshHost, path.join(localPath, entry.name), remoteSubdir, excludeNames, debug, sshConfig);
  }
}

async function scpToVM(sshHost, work, vmwork, osName, debug, disableCache) {
  const sshConfig = { host: sshHost, osName, work, vmwork };
  core.info(`==> Ensuring ${vmwork} exists...`);
  await execSSH(`mkdir -p ${vmwork}`, sshConfig);

  const excludeNote = disableCache ? "" : ", cache.tzst";
  core.info(`==> Uploading files via scp (excluding _actions, _PipelineMapping${excludeNote})...`);

  const items = await fs.promises.readdir(work, { withFileTypes: true });

  for (const item of items) {
    const itemName = item.name;
    if (itemName === "_actions" || itemName === "_PipelineMapping") {
      continue;
    }

    const localPath = path.join(work, itemName);

    // `cache.tzst` is written by the background Save-Cache task and may vanish
    // mid-transfer, which would fail `scp -r`. If the tree contains one, fall
    // back to per-file scp that skips it. Skipped entirely when cache is disabled.
    if (!disableCache && item.isDirectory() && await treeContainsFile(localPath, "cache.tzst")) {
      await scpTreeExcluding(sshHost, localPath, vmwork, ["cache.tzst"], debug, sshConfig);
      continue;
    }

    const scpArgs = [
      "-O",
      "-r",
      "-p",
      "-o", "StrictHostKeyChecking=no",
      localPath,
      `${sshHost}:${vmwork}/`
    ];

    if (debug === 'true') {
      core.info(`Uploading: ${localPath} to ${sshHost}:${vmwork}/`);
    }
    await exec.exec("scp", scpArgs, { silent: debug !== 'true' });
  }

  core.info("==> Done.");
}

async function main() {
  try {
    // 1. Inputs
    const debug = core.getInput("debug");
    // NOT lowercased: a release name can carry upper case (openEuler ships
    // "24.03-LTS-SP4"), and it is used verbatim for the conf file name AND
    // handed to anyvm.py, which builds the image asset URL from it. The conf
    // lookup below still matches case-insensitively, so a user typing
    // "24.03-lts-sp4" keeps working and gets the canonical spelling back.
    const releaseInput = core.getInput("release");
    const archInput = core.getInput("arch").toLowerCase();
    const inputOsName = core.getInput("osname").toLowerCase();
    const mem = core.getInput("mem");
    const cpu = core.getInput("cpu");
    const nat = core.getInput("nat");
    const envs = core.getInput("envs");
    const prepare = core.getInput("prepare");
    const run = core.getInput("run");
    // The effective default is resolved against the conf's VM_SYNC_METHODS
    // once the config is loaded (see below); empty here means "use the conf
    // default".
    let sync = core.getInput("sync").toLowerCase();
    const copyback = core.getInput("copyback").toLowerCase();
    const syncTime = core.getInput("sync-time").toLowerCase();
    const disableCache = core.getInput("disable-cache").toLowerCase() === 'true';
    const cacheAfterPrepareInput = core.getInput("cache-after-prepare").toLowerCase() === 'true';
    let debugOnError = core.getInput("debug-on-error").toLowerCase() === 'true';
    const vncPassword = core.getInput("vnc-password");

    const work = path.join(process.env["HOME"], "work");
    let vmwork = path.join(process.env["HOME"], "work");
    if (inputOsName === 'haiku') {
      vmwork = `/boot/home/${os.userInfo().username}/work`;
    } else if (inputOsName === 'blissos') {
      // BlissOS (Android) logs in as root via dropbear with HOME=/data/dropbear.
      // The system partition is read-only at runtime, so /data/dropbear is the
      // only writable, persistent path; the runner's $HOME/work does not exist
      // in the guest. (Same situation as Haiku: env paths are rewritten to this
      // vmwork by the injection block in execSSH.)
      vmwork = `/data/dropbear/work`;
    }

    // 2. Load Config
    let env = {};
    // Defaults
    env = parseConfig(path.join(__dirname, 'conf/default.release.conf'), env);

    let release = releaseInput || env['DEFAULT_RELEASE'];
    let arch = archInput;

    // Handle Arch logic
    if (!arch) {
      // x86_64 implicit -- unless the repo declares another default arch in
      // conf/default.release.conf (ReactOS ships i386 only, RISC OS armv7
      // only; neither has an x86_64 build at all).
      arch = (env['DEFAULT_ARCH'] || '').toLowerCase();
    } else if (arch === 'arm64') {
      arch = 'aarch64';
    } else if (arch === 'x86_64' || arch === 'amd64') {
      arch = '';
    }


    // Load specific conf files
    const confDir = path.join(__dirname, 'conf');
    let confName = release;
    if (arch) confName += `-${arch}`;
    let confPath = path.join(confDir, `${confName}.conf`);

    if (!fs.existsSync(confPath)) {
      // Fall back to a case-insensitive match on the conf directory, then
      // adopt the file's spelling as the canonical release: the conf name and
      // the release passed to anyvm.py must match the builder's asset names
      // exactly (e.g. "24.03-LTS-SP4"), whatever case the user typed.
      const wanted = `${confName.toLowerCase()}.conf`;
      const found = fs.readdirSync(confDir).find((f) => f.toLowerCase() === wanted);
      if (found) {
        confName = found.slice(0, -'.conf'.length);
        release = arch ? confName.slice(0, -(arch.length + 1)) : confName;
        confPath = path.join(confDir, found);
      }
    }

    if (!fs.existsSync(confPath)) {
      // Not a full release name: take it as the leading, dot separated part of
      // one and run the newest release that starts with it, so "release: 14"
      // follows 14.x and "release: 14.3" follows 14.3.x on their own.
      const resolved = resolveReleasePrefix(confDir, release, arch);
      if (resolved) {
        core.info(`Release "${release}" resolved to "${resolved.release}"`);
        release = resolved.release;
        confName = resolved.confName;
        confPath = path.join(confDir, `${confName}.conf`);
      }
    }

    if (!fs.existsSync(confPath)) {
      const available = listConfReleases(confDir, arch).map((r) => r.release);
      throw new Error(
        `Release "${release}" is not available` +
        (arch ? ` for arch ${arch}` : '') +
        ` (config not found: ${confPath}).` +
        (available.length ? ` Available releases: ${available.join(', ')}` : ''));
    }

    env = parseConfig(confPath, env);

    const anyvmVersion = env['ANYVM_VERSION'];
    const builderVersion = env['BUILDER_VERSION'];
    const osName = inputOsName;

    // VM_SYNC_METHODS is the builder's declared support list for this
    // release/arch (comma separated, first = default), baked into the conf.
    // When the conf doesn't declare it (e.g. an older builder version that
    // predates this field), keep the legacy behavior: default to rsync and
    // don't reject anything.
    const syncMethods = (env['VM_SYNC_METHODS'] || '')
      .split(',').map((m) => m.trim()).filter(Boolean);
    if (!sync) {
      sync = syncMethods[0] || 'rsync';
    } else if (sync !== 'no' && syncMethods.length && !syncMethods.includes(sync)) {
      // Only reject when the conf actually declares a list and this method is
      // not in it. 'no' (do-not-sync) is always allowed.
      throw new Error(
        `sync method '${sync}' is not supported by ${osName} ${confName}. ` +
        `Supported methods: ${syncMethods.join(', ')}`);
    }

    // Remote-exec transport, declared per release conf (VM_TRANSPORT=telnet).
    // The telnet guests (ReactOS, Redox, RISC OS) ship no sshd at all: anyvm
    // drives them over a baked-in telnet agent, and this action runs
    // prepare/run/copyback through `anyvm.py --attach` instead of ssh.
    const transport = (env['VM_TRANSPORT'] || 'ssh').toLowerCase();
    const isTelnet = transport === 'telnet';
    // Guest-side work dir. The ssh guests use $HOME/work (with the per-OS
    // overrides above); a telnet guest has no $HOME contract, so its conf
    // declares the path (ReactOS: C:\work, Redox / RISC OS: /work).
    if (env['VM_WORKPATH']) {
      vmwork = env['VM_WORKPATH'];
    }
    if (isTelnet && debugOnError) {
      core.warning(`debug-on-error is not supported on ${osName} (telnet transport, no ssh); ignoring it.`);
      debugOnError = false;
    }
    if (isTelnet && envs) {
      core.warning(`envs is not supported on ${osName} (telnet transport, no ssh SendEnv); ignoring it.`);
    }

    core.startGroup("Configuration AnyVM.org");
    core.info(`Using ANYVM_VERSION: ${anyvmVersion}`);
    core.info(`Using BUILDER_VERSION: ${builderVersion}`);
    core.info(`Target OS: ${osName}, Release: ${release}`);

    // 3. Download anyvm.py
    if (!anyvmVersion) {
      throw new Error("ANYVM_VERSION not defined in config");
    }
    // Fetch the runtime as a release asset of the pinned version, the same
    // matched-pair rule the VM images follow -- never a branch, never
    // releases/latest.
    const anyvmUrl = `https://github.com/anyvm-org/anyvm/releases/download/v${anyvmVersion}/anyvm.py`;
    const anyvmPath = path.join(__dirname, 'anyvm.py');
    // No raw-URL fallback on purpose: a pinned version whose release has no
    // anyvm.py asset is a bad pin, and quietly pulling the tag's raw file
    // would hide that behind a warning nobody reads. Fail with a message that
    // says what to fix.
    try {
      await downloadFile(anyvmUrl, anyvmPath);
    } catch (err) {
      throw new Error(
        `Could not download anyvm.py for v${anyvmVersion} (${err.message}). ` +
        `Check that the anyvm release v${anyvmVersion} exists and has anyvm.py ` +
        `attached as a release asset.`);
    }
    core.endGroup();

    core.startGroup("Installing dependencies");
    await install(arch, sync, builderVersion, debug, disableCache);
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
    const remoteVncLinkFile = path.join(datadir, "remotevnc.link");
    if (!fs.existsSync(datadir)) {
      fs.mkdirSync(datadir, { recursive: true });
    }
    args.push("--data-dir", datadir);

    // cacheDir is what we restore/save via @actions/cache and pass to anyvm.py --cache-dir (>=0.1.4)
    const cacheSupported = isAnyvmCacheSupported(anyvmVersion);
    const cacheDirInput = core.getInput("cache-dir") || '';
    let cacheDir;
    const archForKey = arch || (process.arch === 'x64' ? 'amd64' : process.arch);
    // -v3: default cacheDir moved from os.tmpdir() to _actions/_vmcache. The
    // cache tar stores absolute paths, so entries saved under /tmp must not
    // be restored against the new location; bumping the key keeps them apart.
    const cacheKey = `${osName}-${release}-${builderVersion || 'default'}-${archForKey}-v3`;
    const restoreKeys = [cacheKey];
    let restoredKey = null;

    // cache-after-prepare: cache the qcow2 again after 'prepare' has run, so
    // the next run with the same prepare script boots the prepared image and
    // skips 'prepare' entirely. The key includes a hash of the prepare script
    // and the sync method, so changing either falls back to the base image.
    // Not usable on win32 hosts (the shutdown wait relies on pgrep/pkill).
    let cacheAfterPrepare = cacheAfterPrepareInput;
    if (cacheAfterPrepare && (!prepare || !cacheSupported || disableCache || process.platform === 'win32' || isTelnet)) {
      core.info(`Ignoring cache-after-prepare (prepare: ${!!prepare}, cacheSupported: ${cacheSupported}, disableCache: ${disableCache}, platform: ${process.platform}, telnet: ${isTelnet})`);
      cacheAfterPrepare = false;
    }
    const prepHash = crypto.createHash('sha256').update(`${prepare}\n${sync}`).digest('hex').slice(0, 16);
    // Deliberately NOT a prefix-extension of cacheKey ("-prep-" replaces the
    // "-v3" tail position), so a prefix restore of the base key can never
    // match a prepared-image entry and vice versa.
    const prepCacheKey = `${osName}-${release}-${builderVersion || 'default'}-${archForKey}-prep-${prepHash}-v3`;
    let prepRestored = false;

    core.startGroup("Cache");
    if (cacheSupported && !disableCache) {
      // Default under <work>/_actions/_vmcache, NOT os.tmpdir(): the
      // ubuntu-26.04 runner image enforces a disk quota on /tmp smaller than
      // one extracted qcow2 (EDQUOT, vmactions/freebsd-vm#148). _actions sits
      // on the roomy work volume, is already excluded from every push-sync
      // path (rsync/scp/tar all skip the _actions name), and unlike a path
      // under __dirname it does not embed the action ref -- the cache tar
      // stores absolute paths, so a ref-dependent path would break restores
      // between @v1 and pinned-tag checkouts. RUNNER_TEMP (<work>/_temp)
      // would be pushed into the guest by the sync; /tmp is quota'd.
      const actionsRoot = path.resolve(__dirname, '..', '..', '..');
      const cacheBaseDir = path.basename(actionsRoot) === '_actions' ? path.join(actionsRoot, '_vmcache') : os.tmpdir();
      cacheDir = cacheDirInput ? expandVars(cacheDirInput, process.env) : path.join(cacheBaseDir, cacheKey);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      if (cacheAfterPrepare) {
        try {
          const prepKeyHit = await cache.restoreCache([cacheDir], prepCacheKey);
          if (prepKeyHit) {
            prepRestored = true;
            // Also disables the base-image background save below: cacheDir
            // now holds the prepared image, not the pristine base image.
            restoredKey = prepKeyHit;
            core.info(`Prepared-image cache restored: ${prepKeyHit}`);
          }
        } catch (e) {
          core.warning(`Prepared-image cache restore failed: ${e.message}`);
        }
        if (!prepRestored) {
          core.info(`No prepared-image cache for ${prepCacheKey}; will run 'prepare' and cache the image afterwards`);
          // Clear partial-restore leftovers before the base-image restore.
          try {
            if (fs.readdirSync(cacheDir).length > 0) {
              core.warning('Prepared-image cache restore left files behind. Clearing cache directory.');
              fs.rmSync(cacheDir, { recursive: true, force: true });
              fs.mkdirSync(cacheDir, { recursive: true });
            }
          } catch (err) {
            core.warning(`Failed to clear cache directory: ${err.message}`);
          }
        }
      }

      if (!prepRestored) {
        try {
          const restoreStart = Date.now();
          try {
            restoredKey = await cache.restoreCache([cacheDir], cacheKey, restoreKeys);
          } catch (e) {
            core.warning(`cache.restoreCache() threw error: ${e.message}`);
          }
          const restoreElapsed = Date.now() - restoreStart;
          core.info(`cache.restoreCache() took ${restoreElapsed}ms`);

          if (restoredKey) {
            core.info(`Cache restored: ${restoredKey}`);
            if (debug === 'true' && cacheDir && fs.existsSync(cacheDir)) {
              core.info('Restored cache dir preview (debug)');
              try {
                await exec.exec('ls', ['-R', cacheDir]);
              } catch (e) {
                core.warning(`Listing restored cache dir failed: ${e.message}`);
              }
            }
          } else {
            // Detect if restore failed silently but left files (e.g. tar error)
            const files = fs.readdirSync(cacheDir).filter(f => f !== '.' && f !== '..');
            if (files.length > 0) {
              core.warning(`Cache hit might have occurred but restoration failed (corrupted or partial download). Clearing cache directory.`);
              try {
                fs.rmSync(cacheDir, { recursive: true, force: true });
                fs.mkdirSync(cacheDir, { recursive: true });
              } catch (err) {
                core.warning(`Failed to clear corrupted cache directory: ${err.message}`);
              }
            } else {
              core.info('No cache hit for VM cache directory');
            }
          }
        } catch (e) {
          core.warning(`Cache restore process failed: ${e.message}`);
        }

        if (!restoredKey) {
          try {
            if (cacheDir && fs.existsSync(cacheDir)) {
              core.info(`Clearing cache directory for a fresh start: ${cacheDir}`);
              fs.rmSync(cacheDir, { recursive: true, force: true });
              fs.mkdirSync(cacheDir, { recursive: true });
            }
          } catch (err) {
            core.warning(`Failed to clear cache directory: ${err.message}`);
          }
        }
      }

      // Pass cache dir to anyvm
      args.push("--cache-dir", cacheDir);
    } else {
      core.info(`anyvm cache-dir skip cache (cacheSupported: ${cacheSupported}, disableCache: ${disableCache}).`);
    }
    core.endGroup();
    core.setOutput("cache-after-prepare-hit", prepRestored ? "true" : "false");

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
          core.startGroup("Permissions");
          try {
            core.info(`Setting permissions for ${homeDir}...`);
            fs.chmodSync(homeDir, '755');
          } catch (err) {
            core.warning(`Failed to chmod ${homeDir}: ${err.message}`);
          }
          core.endGroup();
        }
      }
      if (sync === 'scp' || sync === 'rsync') {
        //we will sync later
        isScpOrRsync = true;
      } else {
        // On a Linux host use the host kernel NFS server ('sys-nfs') instead of
        // the portable userspace 'nfs' server; other hosts keep 'nfs'. Only when
        // anyvm.py is new enough to understand 'sys-nfs' (>=0.4.9).
        let syncArg = sync;
        if (sync === 'nfs' && process.platform === 'linux' && isAnyvmSysNfsSupported(anyvmVersion)) {
          syncArg = 'sys-nfs';
        }
        args.push("--sync", syncArg);
        // Same exclusions the rsync/scp paths already apply, which the tar
        // and 9P backends had no way to receive: _actions holds this
        // action's own node_modules (thousands of files the guest never
        // needs), and shipping it is what made a ReactOS push spend half an
        // hour and still not finish.
        if (syncArg === 'tar' || syncArg === '9p') {
          args.push("--sync-exclude", "_actions");
          args.push("--sync-exclude", "_PipelineMapping");
          if (!disableCache) {
            args.push("--sync-exclude", "cache.tzst");
          }
        }
        args.push("-v", `${work}:${vmwork}`);
      }
    }


    args.push("-d"); // Background/daemon

    let sshHost = osName;
    if (isTelnet) {
      // No ssh config to write; instead pin the control-channel forward so
      // the --attach calls below know where the running VM listens.
      args.push("--ssh-port", String(TELNET_CTRL_PORT));
      if (sync === '9p') {
        args.push("--p9-port", String(P9_PORT));
      }
    } else {
      args.push("--ssh-name", sshHost);
    }

    // With cache-after-prepare on a prepared-cache miss the first boot must be
    // writable, so 'prepare' persists into the qcow2 copy in data-dir; the VM
    // is then shut down, rebooted with --snapshot from that prepared image,
    // and the image is cached (see the block after the 'prepare' step). Every
    // other boot keeps the usual throwaway --snapshot mode.
    const firstBootWritable = cacheAfterPrepare && !prepRestored;
    if (!firstBootWritable) {
      args.push("--snapshot");
    }
    if (osName === 'haiku') {
      args.push("--vga", "std");
    }

    if (debugOnError) {
      args.push("--remote-vnc");
      args.push("--accept-vm-ssh");
      args.push("--remote-vnc-link-file", remoteVncLinkFile);
      if (vncPassword) {
        args.push("--vnc-password", vncPassword);
      }

    } else {
      args.push("--vnc", "off");
    }

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
    let baseSavePromise = null;
    if (cacheSupported && !disableCache) {
      const saveVmCache = async () => {
        activeBackgroundTasks++;
        core.info("Save Cache (Background)");
        if (debug === 'true' && cacheDir && fs.existsSync(cacheDir)) {
          core.info('Cache dir preview (debug)');
          try {
            await exec.exec('du', ['-sh', cacheDir]);
            await exec.exec('find', [cacheDir, '-maxdepth', '5', '-type', 'f']);
          } catch (e) {
            core.warning(`Listing cache dir failed: ${e.message}`);
          }
        }
        try {
          if (!restoredKey && cacheDir && fs.existsSync(cacheDir)) {
            await cache.saveCache([cacheDir], cacheKey);
            core.info(`Cache saved: ${cacheKey}`);
          } else {
            core.info('Skip cache save (cache was restored or directory missing)');
          }
        } catch (e) {
          if (e.message && (e.message.includes('cache entry not found') ||
            e.message.includes('already exists') ||
            e.message.includes('Cache already exists'))) {
            core.info(`Cache save skipped (benign): ${e.message}`);
          } else {
            core.warning(`Cache save failed: ${e.message}`);
          }
        } finally {
          activeBackgroundTasks--;
        }
      };
      baseSavePromise = saveVmCache();
      backgroundPromises.push(baseSavePromise);
    }

    if (!isTelnet) {
      core.startGroup("SSH Config");
      const sshDir = path.join(process.env["HOME"], ".ssh");
      if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { recursive: true });
      }
      const sshConfigPath = path.join(sshDir, "config");

      let sendEnvs = [];
      if (envs) {
        sendEnvs.push(envs);
      }
      // Only use wildcard GITHUB_* if not on Haiku/BlissOS. On those we inject the
      // GITHUB_* vars over the sh stdin instead, rewriting the runner work path to
      // the guest vmwork path (see the injection block in execSSH).
      if (osName !== 'haiku' && osName !== 'blissos') {
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
      core.endGroup();
    }

    const sshConfig = {
      host: sshHost,
      osName: osName,
      work: work,
      vmwork: vmwork,
      envs: envs
    };

    //support Custom shell
    const customShellName = core.getInput("custom-shell-name") || sshHost;
    const localBinDir = path.join(process.env["HOME"], ".local", "bin");
    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }

    const sshWrapperPath = path.join(localBinDir, customShellName);
    // With sync rsync/scp the work tree is copied into the VM once at action
    // start and copied back once when this main step ends -- files created by
    // a later custom-shell step would otherwise stay in the VM and never
    // reach the host (vmactions/freebsd-vm#128). Make every custom-shell step
    // self-syncing: push the work tree before the command and pull it back
    // after. rsync transfers are incremental; scp guests have no rsync in the
    // image, so they reuse the main sync's transports (scp -O push, cpio/tar
    // over ssh pull) as full copies. nfs/sshfs are live mounts and keep the
    // plain wrapper.
    let sshWrapperContent;
    if (isTelnet) {
      // No ssh and no POSIX shell in the guest: later `shell:` steps cannot
      // work here. Leave a wrapper that says so plainly instead of failing
      // with a confusing ssh error.
      sshWrapperContent = `#!/usr/bin/env sh
echo "custom shell steps are not supported on ${osName} (telnet transport, no ssh)" >&2
exit 1
`;
    } else if (sync === 'rsync') {
      const shellSlowArch = isSlowEmulatedArch(arch);
      const shellRsyncSsh = shellSlowArch ? RSYNC_SSH_SLOW : "ssh";
      const shellRsyncTimeout = shellSlowArch ? ` --timeout ${RSYNC_SLOW_TIMEOUT}` : "";
      const shellPushFlags = debug === 'true' ? "-avrtopg" : "-artopg";
      const shellPullFlags = debug === 'true' ? "-av" : "-a";
      const shellCacheExclude = disableCache ? "" : " --exclude cache.tzst";
      // Escaped for embedding in a single-quoted sh string.
      const shellRsyncPath = REMOTE_RSYNC_PATH.replace(/'/g, "'\\''");
      // The pull-back respects copyback=false, like the final copyback. A
      // failed pull turns a successful command into a failed step, but never
      // masks the command's own exit code.
      const shellPull = copyback !== 'false' ? `
if ! rsync ${shellPullFlags} --rsync-path "$RSYNC_PATH" --exclude .git${shellRsyncTimeout} -e '${shellRsyncSsh}' '${sshHost}:${vmwork}/' '${work}/'; then
  if [ "$rc" -eq 0 ]; then rc=1; fi
fi
` : "";
      sshWrapperContent = `\
#!/usr/bin/env sh

RSYNC_PATH='${shellRsyncPath}'

rsync ${shellPushFlags} --rsync-path "$RSYNC_PATH" --exclude _actions --exclude _PipelineMapping${shellCacheExclude}${shellRsyncTimeout} -e '${shellRsyncSsh}' '${work}/' '${sshHost}:${vmwork}/' || exit 1

{
  echo 'if [ -d "$GITHUB_WORKSPACE" ]; then cd "$GITHUB_WORKSPACE"; fi'
  cat "$1"
} | ssh ${sshHost} sh
rc=$?
${shellPull}
exit $rc
`;
    } else if (sync === 'scp') {
      // Same per-OS archive choices as the final copyback block: cpio -H
      // ustar by default, plain tar on BlissOS (toybox cpio ignores -H
      // ustar), runtime cpio probe on Haiku.
      let shellPullRemote;
      if (osName === 'blissos') {
        shellPullRemote = `cd "${vmwork}" && tar -cf - --exclude .git .`;
      } else if (osName === 'haiku') {
        shellPullRemote = `cd "${vmwork}" && if command -v cpio >/dev/null 2>&1; then find . -name .git -prune -o -print | cpio -o -H ustar; else tar -cf - --exclude .git .; fi`;
      } else {
        shellPullRemote = `cd "${vmwork}" && find . -name .git -prune -o -print | cpio -o -H ustar`;
      }
      const shellScpFlags = debug === 'true' ? "-O -r -p" : "-O -r -p -q";
      const shellScpPull = copyback !== 'false' ? `
if ! ssh ${sshHost} '${shellPullRemote}' | tar -xf - -C '${work}'; then
  if [ "$rc" -eq 0 ]; then rc=1; fi
fi
` : "";
      sshWrapperContent = `\
#!/usr/bin/env sh

for item in '${work}'/* '${work}'/.[!.]* '${work}'/..?*; do
  [ -e "$item" ] || continue
  case "$item" in
    */_actions|*/_PipelineMapping|*/cache.tzst) continue ;;
  esac
  scp ${shellScpFlags} -o StrictHostKeyChecking=no "$item" '${sshHost}:${vmwork}/' || exit 1
done

{
  echo 'if [ -d "$GITHUB_WORKSPACE" ]; then cd "$GITHUB_WORKSPACE"; fi'
  cat "$1"
} | ssh ${sshHost} sh
rc=$?
${shellScpPull}
exit $rc
`;
    } else {
      sshWrapperContent = `\
#!/usr/bin/env sh

{
  echo 'if [ -d "$GITHUB_WORKSPACE" ]; then cd "$GITHUB_WORKSPACE"; fi'
  cat "$1"
} | ssh ${sshHost} sh
`;
    }
    fs.writeFileSync(sshWrapperPath, sshWrapperContent);
    fs.chmodSync(sshWrapperPath, '755');

    const onStartedHook = path.join(__dirname, 'hooks', 'onStarted.sh');
    if (fs.existsSync(onStartedHook) && !isTelnet) {
      core.startGroup(`Running onStarted hook: ${onStartedHook}`);
      const hookContent = fs.readFileSync(onStartedHook, 'utf8');
      await execSSH(hookContent, sshConfig, false, debug !== 'true');
      core.endGroup();
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

      // Short, idempotent housekeeping commands -- wrap in timeout+retry so a
      // wedged ssh session does not hang the whole job for the GHA 6-hour max.
      // (Observed: ssh produced its output but never disconnected; see haiku-vm
      // run 26416580769.) User-supplied prepare/run scripts stay unbounded.
      await execSSH(`rm -rf ${vmwork}`, { ...sshConfig }, false, false, { timeoutMs: 120000, retries: 2 });
      await execSSH(`mkdir -p ${vmwork}`, { ...sshConfig }, false, false, { timeoutMs: 60000, retries: 2 });
      if (sync === 'scp') {
        core.info("Syncing via SCP");
        await scpToVM(sshHost, work, vmwork, osName, debug, disableCache);
      } else {
        core.info("Syncing via Rsync");
        const slowArch = isSlowEmulatedArch(arch);
        const rsyncArgs = [debug === 'true' ? "-avrtopg" : "-artopg", `--rsync-path=${REMOTE_RSYNC_PATH}`, "--exclude", "_actions", "--exclude", "_PipelineMapping"];
        if (!disableCache) {
          rsyncArgs.push("--exclude", "cache.tzst");
        }
        if (slowArch) {
          rsyncArgs.push("--timeout", RSYNC_SLOW_TIMEOUT);
        }
        rsyncArgs.push("-e", slowArch ? RSYNC_SSH_SLOW : "ssh", work + "/", `${sshHost}:${vmwork}/`);
        await exec.exec("rsync", rsyncArgs);
        if (debug) {
          core.startGroup("Debug: Checking VM work directory content");
          await execSSH(`ls -lah ${vmwork}`, { ...sshConfig }, false, false, { timeoutMs: 60000, retries: 2 });
          core.endGroup();
        }
      }
      core.endGroup();
    }
    if (sync !== 'no' && !isTelnet) {
      core.startGroup('Creating workdir symlink');
      // Make the ln retry-safe without deleting $HOME/work: if a prior attempt
      // already created the symlink but the ssh channel hung, just skip re-linking
      // instead of erroring on "File exists". The work tree itself is cleaned
      // earlier by `rm -rf ${vmwork}`.
      await execSSH(`[ -L "$HOME/work" ] || ln -s ${vmwork} $HOME/work`, { ...sshConfig }, false, false, { timeoutMs: 60000, retries: 2 });
      core.endGroup();
    }
    let prepareRanOk = false;
    try {
      core.startGroup("Run 'prepare' in VM");
      if (prepare && prepRestored) {
        core.info(`Skipping 'prepare': prepared-image cache was restored (${prepCacheKey})`);
      } else if (prepare) {
        if (isTelnet) {
          // No $GITHUB_WORKSPACE in the guest: commands run against the
          // conf-declared work path (the -v target) with absolute paths.
          await execTelnetScript(prepare, osName, anyvmPath);
        } else {
          const prepareCmd = (sync !== 'no') ? `cd "$GITHUB_WORKSPACE"\n${prepare}` : prepare;
          await execSSH(prepareCmd, { ...sshConfig });
        }
        prepareRanOk = true;
      }
      core.endGroup();
    } catch (err) {
      core.endGroup();
      if (debugOnError) {
        let vncLink = "";
        if (fs.existsSync(remoteVncLinkFile)) {
          vncLink = fs.readFileSync(remoteVncLinkFile, 'utf8').split('\n')[0].trim();
        }
        await handleErrorWithDebug(sshHost, vncLink, debug);
      } else {
        throw err;
      }
    }

    // cache-after-prepare, prepared-cache miss: the VM has been running
    // writable, so 'prepare' is now baked into the qcow2 in data-dir. Shut the
    // guest down cleanly, reboot it in the usual --snapshot mode from that
    // prepared image, and cache the image in the background while 'run'
    // executes. Skipped when 'prepare' failed (debug-on-error path): a
    // half-prepared image must never be cached.
    if (firstBootWritable && prepareRanOk) {
      core.startGroup("Restarting VM to cache the prepared image");
      const shutdownCmd = env['VM_SHUTDOWN_CMD'] || SHUTDOWN_CMDS[osName] || 'poweroff';
      core.info(`Shutting down the VM: ${shutdownCmd}`);
      // The shutdown kills the very ssh connection it runs over; ignore the
      // exit code and cap the session so a half-open channel cannot hang here.
      await execSSH(shutdownCmd, { ...sshConfig }, true, false, { timeoutMs: 120000 });

      core.info("Waiting for QEMU to exit...");
      let cleanShutdown = false;
      const shutdownDeadline = Date.now() + 1800000;
      for (;;) {
        const pgrepCode = await exec.exec('pgrep', ['-f', 'qemu-system-'], { ignoreReturnCode: true, silent: true });
        if (pgrepCode !== 0) {
          cleanShutdown = true;
          break;
        }
        if (Date.now() > shutdownDeadline) {
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (!cleanShutdown) {
        core.warning('VM did not power off within 30 minutes; force-killing QEMU and skipping the prepared-image cache save');
        await exec.exec('pkill', ['-f', 'qemu-system-'], { ignoreReturnCode: true });
        await new Promise((r) => setTimeout(r, 10000));
      }

      // anyvm writes ssh aliases as ~/.ssh/config.d/<port>.conf and
      // <vm_name>.conf. The reboot may pick a DIFFERENT ssh port (the old one
      // can linger in TIME_WAIT and fail anyvm's free-port probe), so it
      // generates new files while the first boot's files still claim the same
      // aliases -- and ssh reads config.d includes in lexical order with
      // first-match-wins, resolving the alias to the dead port (tribblix-vm
      // run 29497155045: alias kept port 10022, rebooted VM listened on
      // 10023). Drop every config.d entry naming our alias before rebooting.
      const sshConfD = path.join(process.env["HOME"], ".ssh", "config.d");
      if (fs.existsSync(sshConfD)) {
        const aliasRe = new RegExp(`^Host\\b.*\\b${sshHost}`, 'm');
        for (const fname of fs.readdirSync(sshConfD)) {
          if (!fname.endsWith('.conf')) {
            continue;
          }
          const staleConf = path.join(sshConfD, fname);
          try {
            if (aliasRe.test(fs.readFileSync(staleConf, 'utf8'))) {
              fs.unlinkSync(staleConf);
              core.info(`Removed stale ssh config: ${staleConf}`);
            }
          } catch (e) {
            core.warning(`Failed to check/remove ${staleConf}: ${e.message}`);
          }
        }
      }

      // Reboot from the prepared qcow2 left in data-dir: drop --cache-dir (in
      // snapshot mode anyvm would boot the pristine cached image instead of
      // the prepared one) and add --snapshot.
      const rebootArgs = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--cache-dir') {
          i++;
          continue;
        }
        rebootArgs.push(args[i]);
      }
      rebootArgs.push('--snapshot');
      await exec.exec("python3", rebootArgs, options);
      core.endGroup();

      if (cleanShutdown) {
        const savePreparedCache = async () => {
          activeBackgroundTasks++;
          core.info("Save prepared-image cache (Background)");
          try {
            // The base-image save tars cacheDir; wait for it before
            // overwriting the qcow2 inside the same directory.
            if (baseSavePromise) {
              await baseSavePromise;
            }
            const findQcow2 = (dir) => {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const found = findQcow2(p);
                  if (found) return found;
                } else if (entry.name.endsWith('.qcow2')) {
                  return p;
                }
              }
              return null;
            };
            const preparedQcow2 = findQcow2(datadir);
            if (!preparedQcow2) {
              throw new Error(`no qcow2 found under ${datadir}`);
            }
            // Reading the image is safe: the rebooted VM runs with -snapshot,
            // so QEMU never writes to it. Mirror the data-dir layout inside
            // cacheDir so anyvm finds the image at the same relative path.
            const destQcow2 = path.join(cacheDir, path.relative(datadir, preparedQcow2));
            fs.mkdirSync(path.dirname(destQcow2), { recursive: true });
            await fs.promises.copyFile(preparedQcow2, destQcow2);
            await cache.saveCache([cacheDir], prepCacheKey);
            core.info(`Prepared-image cache saved: ${prepCacheKey}`);
          } catch (e) {
            if (e.message && (e.message.includes('already exists') ||
              e.message.includes('Cache already exists'))) {
              core.info(`Prepared-image cache save skipped (benign): ${e.message}`);
            } else {
              core.warning(`Prepared-image cache save failed: ${e.message}`);
            }
          } finally {
            activeBackgroundTasks--;
          }
        };
        backgroundPromises.push(savePreparedCache());
      }
    }

    try {
      core.startGroup("Run 'run' in VM");
      if (run) {
        if (isTelnet) {
          await execTelnetScript(run, osName, anyvmPath);
        } else {
          const runCmd = (sync !== 'no') ? `cd "$GITHUB_WORKSPACE"\n${run}` : run;
          await execSSH(runCmd, { ...sshConfig });
        }
      }
      core.endGroup();
    } catch (err) {
      core.endGroup();
      if (debugOnError) {
        let vncLink = "";
        if (fs.existsSync(remoteVncLinkFile)) {
          vncLink = fs.readFileSync(remoteVncLinkFile, 'utf8').split('\n')[0].trim();
        }
        await handleErrorWithDebug(sshHost, vncLink, debug);
      } else {
        throw err;
      }
    }

    // 7. Copyback
    if (copyback !== 'false' && sync !== 'no' && sync !== 'sshfs' && sync !== 'nfs') {
      // Wait for background tasks to finish before copyback to avoid file conflicts
      if (backgroundPromises.length > 0 && activeBackgroundTasks > 0) {
        core.info(`Waiting for ${activeBackgroundTasks} background tasks to complete before copyback (max 60s)...`);
        let copybackWaitTimer = null;
        const timeoutPromise = new Promise((resolve) => {
          copybackWaitTimer = setTimeout(() => {
            if (activeBackgroundTasks > 0) {
              core.warning(`Background tasks timed out after 60s. Continuing with copyback...`);
            }
            resolve();
          }, 60000);
        });
        await Promise.race([Promise.allSettled(backgroundPromises), timeoutPromise]);
        clearTimeout(copybackWaitTimer);
      }

      const workspace = process.env['GITHUB_WORKSPACE'];
      if (workspace) {
        core.startGroup("Copyback artifacts");
        if (isTelnet && (sync === 'tar' || sync === '9p')) {
          // Pull the synced tree back through the same channel the push used
          // at boot: a tar stream over telnet, or the guest's 9P share for
          // Plan 9. Neither push is a live mount, so without this the
          // guest's output would never reach the runner.
          const pullArgs = [
            anyvmPath, "--os", osName, "--attach",
            "--ssh-port", String(TELNET_CTRL_PORT),
          ];
          if (sync === '9p') {
            pullArgs.push("--sync", "9p", "--p9-port", String(P9_PORT));
          }
          pullArgs.push("--pull-files", "-v", `${work}:${vmwork}`);
          await exec.exec("python3", pullArgs);
        } else if (sync === 'scp' || sync === 'tar') {
          // scp guests pull with cpio/tar over ssh; an ssh guest running
          // `sync: tar` (push done by anyvm at boot) reuses the same
          // transport for the pull.
          let useCpio = true;
          if (osName === 'blissos') {
            // Toybox cpio ignores `-H ustar` and emits a newc cpio stream that
            // the host `tar -xf` rejects ("This does not look like a tar
            // archive"). Toybox tar writes a standard, host-readable archive,
            // so copy back with tar directly instead of cpio.
            useCpio = false;
          } else if (osName === 'haiku') {
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
          const slowArchBack = isSlowEmulatedArch(arch);
          const copybackArgs = [debug === 'true' ? "-av" : "-a", `--rsync-path=${REMOTE_RSYNC_PATH}`, "--exclude", ".git"];
          if (slowArchBack) {
            copybackArgs.push("--timeout", RSYNC_SLOW_TIMEOUT);
          }
          copybackArgs.push("-e", slowArchBack ? RSYNC_SSH_SLOW : "ssh", `${sshHost}:${vmwork}/`, `${work}/`);
          await exec.exec("rsync", copybackArgs);
        }
        core.endGroup();
      }
    }

    if (backgroundPromises.length > 0) {
      // The prepared-image cache save may still be compressing/uploading a
      // multi-GB qcow2; give it more time than the usual 60s so the freshly
      // prepared image is not lost right before the job ends.
      const finalWaitMs = firstBootWritable ? 1800000 : 60000;
      if (activeBackgroundTasks > 0) {
        core.info(`Waiting for ${activeBackgroundTasks} background tasks to complete (max ${finalWaitMs / 1000}s)...`);
      }
      // Keep the timer handle so it can be cleared: a pending setTimeout would
      // hold the node event loop (and thus the job) open until it fires.
      let finalWaitTimer = null;
      const timeoutPromise = new Promise((resolve) => {
        finalWaitTimer = setTimeout(() => {
          if (activeBackgroundTasks > 0) {
            core.warning(`Background tasks timed out after ${finalWaitMs / 1000}s. Continuing...`);
          }
          resolve();
        }, finalWaitMs);
      });
      await Promise.race([Promise.allSettled(backgroundPromises), timeoutPromise]);
      clearTimeout(finalWaitTimer);
    }

  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
