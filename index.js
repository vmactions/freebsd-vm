const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const fs = require("fs");
const net = require("net")
const path = require("path");

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function execSSH(cmd, desp = "") {
  console.info(desp);
  console.info("exec ssh: " + cmd);
  await exec.exec("ssh -t freebsd", [], { input: cmd });
}

async function isSSHreachable() {
  const promise = new Promise(((resolve, reject) => {
    const socket = new net.Socket();

    const onError = () => {
      socket.destroy();
      reject();
    };

    socket.setTimeout(1000);
    socket.once('error', onError);
    socket.once('timeout', onError);

    socket.connect(2222, 'freebsd', () => {
      socket.end();
      resolve();
    });
  }));

  try {
    await promise;
    return true;
  } catch {
    return false;
  }
}

async function waitFor(vmName, tag) {

  let slept = 0;
  while (true) {
    slept += 1;
    if (slept >= 300) {
      throw new Error("Timeout can not boot");
    }
    await sleep(1000);
    return !!isSSHreachable();
  }
}

async function vboxmanage(vmName, cmd, args = "") {
  await exec.exec("sudo  vboxmanage " + cmd + "   " + vmName + "   " + args);
}

async function setup(version, nat, mem) {
  try {

    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "Host freebsd " + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " User root" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " HostName localhost" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " Port 2222" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "StrictHostKeyChecking=accept-new\n");

    let workingDir = __dirname;

    let url = `https://github.com/expeditioneer/freebsd-builder/releases/latest/download/freebsd-${version}.tar.xz`;

    console.info("Downloading image: " + url);
    let img = await tc.downloadTool(url);
    console.info("Downloaded file: " + img);

    let vmArchive = workingDir + `/freebsd-${version}.tar.xz`;
    await io.mv(img, vmArchive);
    await exec.exec(`tar -xf ${vmArchive} -C ${workingDir}`);

    let sshHome = path.join(process.env["HOME"], ".ssh");
    let authorized_keys = path.join(sshHome, "authorized_keys");

    fs.appendFileSync(authorized_keys, fs.readFileSync(path.join(workingDir, "id_ed25519.pub")));

    fs.appendFileSync(path.join(sshHome, "config"), "SendEnv   CI  GITHUB_* \n");
    await exec.exec("chmod 700 " + sshHome);


    let ova = `freebsd-${version}.ova`;
    await vboxmanage("", "import", path.join(workingDir, ova));


    let vmName = "freebsd";

    if (nat) {
      let nats = nat.split("\n").filter(x => x !== "");
      for (let element of nats) {
        console.info("Add nat: " + element);
        let segs = element.split(":");
        if (segs.length === 3) {
          //udp:"8081": "80"
          let proto = segs[0].trim().trim('"');
          let hostPort = segs[1].trim().trim('"');
          let vmPort = segs[2].trim().trim('"');
          await vboxmanage(vmName, "modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");

        } else if (segs.length === 2) {
          let proto = "tcp"
          let hostPort = segs[0].trim().trim('"');
          let vmPort = segs[1].trim().trim('"');
          await vboxmanage(vmName, "modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");
        }
      }
    }

    if (mem) {
      await vboxmanage(vmName, "modifyvm", "  --memory " + mem);
    }

    await vboxmanage(vmName, "modifyvm", " --cpus 3");

    await vboxmanage(vmName, "startvm", " --type headless");

    console.info("First boot");

    let loginTag = "FreeBSD/amd64 (freebsd) (ttyv";
    await waitFor(vmName, loginTag);

    try {
      await execSSH("ntpdate -b pool.ntp.org || ntpdate -b us.pool.ntp.org || ntpdate -b asia.pool.ntp.org", "Sync FreeBSD time");
    } catch (ex) {
      console.info("can not sync time")
    }
    let cmd1 = "mkdir -p /Users/runner/work && ln -s /Users/runner/work/  work";
    await execSSH(cmd1, "Setting up VM");

    let sync = core.getInput("sync");
    if (sync == "sshfs") {
      let cmd2 = "pkg  install  -y fusefs-sshfs && kldload  fusefs && sshfs -o allow_other,default_permissions runner@10.0.2.2:work /Users/runner/work";
      await execSSH(cmd2, "Setup sshfs");
    } else {
      let cmd2 = "pkg  install  -y rsync";
      await execSSH(cmd2, "Setup rsync");
      await exec.exec("rsync -auvzrtopg  --exclude _actions/vmactions/freebsd-vm  /Users/runner/work/ freebsd:work");
    }

    console.info("OK, Ready!");

  }
  catch (error) {
    core.setFailed(error.message);
  }
}



async function main() {
  let version = core.getInput('version')
  console.log(`FreeBSD version: ${version}`)

  let nat = core.getInput("nat");
  console.info("nat: " + nat);

  let mem = core.getInput("mem");
  console.info("mem: " + mem);

  await setup(version, nat, mem);

  var envs = core.getInput("envs");
  console.log("envs:" + envs);
  if (envs) {
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "SendEnv " + envs + "\n");
  }

  var prepare = core.getInput("prepare");
  if (prepare) {
    console.info("Running prepare: " + prepare);
    await exec.exec("ssh -t freebsd", [], { input: prepare });
  }

  var run = core.getInput("run");
  console.log("run: " + run);

  try {
    var usesh = core.getInput("usesh").toLowerCase() == "true";
    if (usesh) {
      await exec.exec("ssh freebsd sh -c 'cd $GITHUB_WORKSPACE && exec sh'", [], { input: run });
    } else {
      await exec.exec("ssh freebsd sh -c 'cd $GITHUB_WORKSPACE && exec \"$SHELL\"'", [], { input: run });
    }
  } catch (error) {
    core.setFailed(error.message);
  } finally {
    let sync = core.getInput("sync");
    if (sync != "sshfs") {
      console.info("get back by rsync");
      await exec.exec("rsync -uvzrtopg  freebsd:work/ /Users/runner/work");
    }
  }
}

main().catch(ex => {
  core.setFailed(ex.message);
});

