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

    await shell("bash run.sh importVM");


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

