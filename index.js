const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require("fs");
const path = require("path");



var osname = "freebsd";
var loginTag = "FreeBSD/amd64 (freebsd) (tty";
var workingDir = __dirname;

async function execSSH(cmd, desp = "") {
  core.info(desp);
  core.info("exec ssh: " + cmd);
  await exec.exec("ssh -t " + osname, [], { input: cmd });
}


async function shell(cmd, cdToScriptHome = true) {
  core.info("exec shell: " + cmd);
  if(cdToScriptHome) {
    await exec.exec("bash", [], { input: "cd " + workingDir + " && (" + cmd + ")" });
  } else {
    await exec.exec("bash", [], { input:  cmd  });
  }


}


async function setup(nat, mem) {
  try {

    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "Host freebsd " + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " User root" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " HostName localhost" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), " Port 2222" + "\n");
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "StrictHostKeyChecking=accept-new\n");


    await exec.exec("brew install -qf tesseract", [], { silent: true });
    await exec.exec("pip3 install -q pytesseract", [], { silent: true });

    let workingDir = __dirname;

    let url = "https://github.com/vmactions/freebsd-builder/releases/download/v0.0.9/freebsd-13.0.7z";

    core.info("Downloading image: " + url);
    let img = await tc.downloadTool(url);
    core.info("Downloaded file: " + img);

    let s7z = workingDir + "/freebsd-13.0.7z";
    await io.mv(img, s7z);
    await exec.exec("7z e " + s7z + "  -o" + workingDir);

    let sshHome = path.join(process.env["HOME"], ".ssh");
    let authorized_keys = path.join(sshHome, "authorized_keys");

    fs.appendFileSync(authorized_keys, fs.readFileSync(path.join(workingDir, "id_rsa.pub")));

    fs.appendFileSync(path.join(sshHome, "config"), "SendEnv   CI  GITHUB_* \n");
    await exec.exec("chmod 700 " + sshHome);


    let ova = "freebsd-13.0.ova";
    await vboxmanage("", "import", path.join(workingDir, ova));


    let vmName = "freebsd";

    if (nat) {
      let nats = nat.split("\n").filter(x => x !== "");
      for (let element of nats) {
        core.info("Add nat: " + element);
        let segs = element.split(":");
        if (segs.length === 3) {
          //udp:"8081": "80"
          let proto = segs[0].trim().trim('"');
          let hostPort = segs[1].trim().trim('"');
          let vmPort = segs[2].trim().trim('"');

          await shell("bash vbox.sh addNAT " + osname + " " + proto + " " + hostPort + " " + vmPort);

        } else if (segs.length === 2) {
          let proto = "tcp"
          let hostPort = segs[0].trim().trim('"');
          let vmPort = segs[1].trim().trim('"');
          await shell("bash vbox.sh addNAT " + osname + " " + proto + " " + hostPort + " " + vmPort);
        }
      };
    }

    if (mem) {
      await shell("bash vbox.sh setMemory " + osname + " " + mem);
    }

    await shell("bash vbox.sh setCPU " + osname + " 3");

    await shell("bash vbox.sh startVM " + osname );

    core.info("First boot");



    await shell("bash vbox.sh waitForText " + osname + "  '"+ loginTag +"'");

    try {
      await execSSH("ntpdate -b pool.ntp.org || ntpdate -b us.pool.ntp.org || ntpdate -b asia.pool.ntp.org", "Sync FreeBSD time");
    } catch (ex) {
      core.info("can not sync time")
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
      await shell("rsync -auvzrtopg  --exclude _actions/vmactions/" + osname+ "-vm  /Users/runner/work/ " + osname + ":work", false);
    }

    core.info("OK, Ready!");

  }
  catch (error) {
    core.setFailed(error.message);
    await shell("pwd && ls -lah" );
    await shell("bash -c 'pwd && ls -lah ~/.ssh/ && cat ~/.ssh/config'" );
  }
}



async function main() {
  let nat = core.getInput("nat");
  core.info("nat: " + nat);

  let mem = core.getInput("mem");
  core.info("mem: " + mem);

  await setup(nat, mem);

  var envs = core.getInput("envs");
  console.log("envs:" + envs);
  if (envs) {
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "SendEnv " + envs + "\n");
  }

  var prepare = core.getInput("prepare");
  if (prepare) {
    core.info("Running prepare: " + prepare);
    await exec.exec("ssh -t " + osname, [], { input: prepare });
  }

  var run = core.getInput("run");
  console.log("run: " + run);

  try {
    var usesh = core.getInput("usesh").toLowerCase() == "true";
    if (usesh) {
      await exec.exec("ssh " + osname + " sh -c 'cd $GITHUB_WORKSPACE && exec sh'", [], { input: run });
    } else {
      await exec.exec("ssh " + osname + " sh -c 'cd $GITHUB_WORKSPACE && exec \"$SHELL\"'", [], { input: run });
    }
  } catch (error) {
    core.setFailed(error.message);
  } finally {
    let copyback = core.getInput("copyback");
    if(copyback !== "false") {
      let sync = core.getInput("sync");
      if (sync != "sshfs") {
        core.info("get back by rsync");
        await exec.exec("rsync -uvzrtopg  " + osname + ":work/ /Users/runner/work");
      }
    }
  }
}



main().catch(ex => {
  core.setFailed(ex.message);
});

