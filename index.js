const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require("fs");
const path = require("path");
const os = require('os');


var workingDir = __dirname;

async function execSSH(cmd, desp = "") {
  core.info(desp);
  core.info("exec ssh: " + cmd);
  await exec.exec("bash " + workingDir + "/run.sh execSSH", [], { input: cmd });
}

async function execSSHSH(cmd, desp = "") {
  core.info(desp);
  core.info("exec ssh: " + cmd);
  await exec.exec("bash " + workingDir + "/run.sh execSSHSH", [], { input: cmd });
}

async function shell(cmd, cdToScriptHome = true) {
  core.info("exec shell: " + cmd);
  if(cdToScriptHome) {
    await exec.exec("bash", [], { input: "cd " + workingDir + " && (" + cmd + ")" });
  } else {
    await exec.exec("bash", [], { input:  cmd  });
  }


}


async function setup(nat, mem, cpu) {
  try {
    core.startGroup("Importing VM");
    if(!cpu) {
      cpu =  os.cpus().length;//use the system all cores
    }
    core.info("Use cpu: " + cpu);


    await shell("bash run.sh importVM  '" + mem + "'  '" + cpu + "'");
    core.endGroup();


    core.startGroup("Run onBeforeStartVM");
    await shell("bash run.sh onBeforeStartVM " );
    core.endGroup();


    core.startGroup("Run startVM");
    await shell("bash run.sh startVM " );

    core.info("First boot");

    await shell("bash run.sh waitForVMReady");
    core.endGroup();

    core.startGroup("Run onStarted in VM");

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

          await shell("bash run.sh addNAT " + proto + " " + hostPort + " " + vmPort);

        } else if (segs.length === 2) {
          let proto = "tcp"
          let hostPort = segs[0].trim().trim('"');
          let vmPort = segs[1].trim().trim('"');
          await shell("bash run.sh addNAT " + proto + " " + hostPort + " " + vmPort);
        }
      };
    }


    await shell("bash run.sh onStarted" );
    core.endGroup();

    core.startGroup("Initialize files in VM");
    let cmd1 = "mkdir -p " + process.env["HOME"] + "/work && ln -s " + process.env["HOME"] + "/work/  work";
    await execSSH(cmd1, "Setting up VM");

    let sync = core.getInput("sync");
    if(sync == "no") {
      core.info("Don't sync files, OK");
    } else if (sync == "sshfs") {
      core.info("Setup sshfs");
      await shell("bash run.sh runSSHFSInVM");
    } else if (sync == "nfs") {
      core.info("Setup nfs");
      await shell("bash run.sh runNFSInVM");
    } else {
      await shell("bash run.sh installRsyncInVM");
      await shell("bash run.sh rsyncToVM");
    }

    core.info("OK, Ready!");
    core.endGroup();

  }
  catch (error) {
    try {
      await shell("bash run.sh showDebugInfo");
    } catch(ex){}
    core.setFailed(error.message);
    throw error;
  }
}



async function main() {
  let debug = core.getInput("debug");
  process.env.DEBUG = debug;
  let release = core.getInput("release");
  core.info("release: " + release);
  if(release) {
    process.env.VM_RELEASE=release;
  }

  let arch = core.getInput("arch");
  core.info("arch: " + arch);
  if(arch) {
    process.env.VM_ARCH=arch;
  }

  let nat = core.getInput("nat");
  core.info("nat: " + nat);

  let mem = core.getInput("mem");
  core.info("mem: " + mem);

  let cpu = core.getInput("cpu");
  core.info("cpu: " + cpu);

  await setup(nat, mem, cpu);

  var envs = core.getInput("envs");
  console.log("envs:" + envs);

  if (envs) {
    fs.appendFileSync(path.join(process.env["HOME"], "/.ssh/config"), "SendEnv " + envs + "\n");
  }

  core.startGroup("Run onInitialized in VM");
  await shell("bash run.sh onInitialized" );
  core.endGroup();

  core.startGroup("Run 'prepare' in VM");
 
  var usesh = core.getInput("usesh").toLowerCase() == "true";

  var prepare = core.getInput("prepare");
  if (prepare) {
    core.info("Running prepare: " + prepare);
    if (usesh) {
      await execSSHSH(prepare);
    } else {
      await execSSH(prepare);
    }

  }

  core.endGroup();

  core.startGroup("Run 'run' in VM");
  var run = core.getInput("run");
  console.log("run: " + run);


  var error = null;
  try {
    if(run) {
      if (usesh) {
        await execSSHSH("cd $GITHUB_WORKSPACE;\n" + run);
      } else {
        await execSSH("cd $GITHUB_WORKSPACE;\n" + run);
      }
    }
  } catch (err) {
    error = err;
    try {
      await shell("bash run.sh showDebugInfo");
    } catch(ex){}
  } finally {
    core.endGroup();


    let copyback = core.getInput("copyback");
    let sync = core.getInput("sync");
    if(copyback !== "false" && sync != "sshfs" && sync != "nfs" && sync != "no") {
      core.info("get back by rsync");
      await exec.exec("bash " + workingDir + "/run.sh rsyncBackFromVM");
      core.endGroup();
    }
    if(error) {
      core.setFailed(error.message);
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}



main().catch(ex => {
  core.setFailed(ex.message);
});

