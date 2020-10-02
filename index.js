const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const fs = require("fs");
const path = require("path");

async function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function execSSH(cmd, desp = "") {
  core.info(desp);
  core.info("exec ssh: " + cmd);
  await exec.exec("ssh -t -p 2222 root@localhost", [], {input: cmd});
}


async function setup(nat) {
  try {

    await exec.exec("brew install -qf tesseract", [], {silent: true});
    await exec.exec("pip3 install -q pytesseract", [], {silent: true});


    let workingDir=__dirname;
    
    let imgName = "FreeBSD-12.1-RELEASE-amd64";


    let url = "https://github.com/vmactions/freebsd-builder/releases/download/v0.0.6/freebsd-12.1.7z";
    
    core.info("Downloading image: " + url);
    let img = await tc.downloadTool(url);
    core.info("Downloaded file: " + img);

    let s7z = workingDir + "/freebsd-12.1.7z";
    await io.mv(img, s7z);
    await exec.exec("7z e " + s7z + "  -o" + workingDir);

    let vhd = workingDir + "/" + imgName + ".vhd";

    let sshHome = path.join(process.env["HOME"], ".ssh");
    let authorized_keys = path.join(sshHome, "authorized_keys");

    fs.appendFileSync(authorized_keys, fs.readFileSync(path.join(workingDir, "id_rsa.pub")));
    fs.appendFileSync(path.join(sshHome, "config"), "StrictHostKeyChecking=accept-new\n");
    fs.appendFileSync(path.join(sshHome, "config"), "SendEnv   CI  GITHUB_* \n");
    await exec.exec("chmod 700 " + sshHome);

    let vmName = "freebsd";
    core.info("Create VM");
    await exec.exec("sudo vboxmanage  createvm  --name " + vmName + " --ostype FreeBSD_64  --default   --basefolder freebsd --register");
    
    await exec.exec("sudo vboxmanage  storagectl " + vmName + "  --name SATA --add sata  --controller IntelAHCI ");
    
    await exec.exec("sudo vboxmanage  storageattach "+ vmName + "    --storagectl SATA --port 0  --device 0  --type hdd --medium " + vhd);
    
    await exec.exec("sudo vboxmanage modifyvm "+ vmName + " --vrde on  --vrdeport 33389");

    await exec.exec("sudo vboxmanage modifyvm "+ vmName + "  --natpf1 'guestssh,tcp,,2222,,22'");
    
    if(nat) {
      let nats = nat.split("\n").filter(x => x !== "");
      for(let element of nats) {
        core.info("Add nat: " + element);
        let segs = element.split(":");
        if(segs.length === 3) {
          //udp:"8081": "80"
          let proto = segs[0].trim().trim('"');
          let hostPort = segs[1].trim().trim('"');
          let vmPort = segs[2].trim().trim('"');

          await exec.exec("sudo vboxmanage modifyvm "+ vmName + "  --natpf1 '"+ hostPort +"," + proto + ",," + hostPort+",,"+ vmPort + "'");
    
        } else if(segs.length === 2) {
          let proto = "tcp"
          let hostPort = segs[0].trim().trim('"');
          let vmPort = segs[1].trim().trim('"');
          await exec.exec("sudo vboxmanage modifyvm "+ vmName + "  --natpf1 '"+ hostPort +"," + proto + ",," + hostPort+",,"+ vmPort + "'");
    
        }
      };
    }

    await exec.exec("sudo vboxmanage startvm " + vmName + " --type headless");

    core.info("sleep 300 seconds for first boot");
    let loginTag="FreeBSD/amd64 (freebsd) (ttyv0)"
    let slept = 0;
    while(true) {
      slept +=20;
      if(slept >= 300) {
        throw new Error("Timeout can not boot");
      }
      await sleep(20000);

      await exec.exec("sudo  vboxmanage  controlvm " + vmName + "  screenshotpng  screen.png")


      await exec.exec("sudo chmod 666 screen.png");

      let output="";
      await exec.exec("pytesseract  screen.png", [] , {listeners:{stdout:(s)=>{
        output += s;
      }}});
    
      
      if(output.includes(loginTag)) {
        core.info("Login ready, sleep last 10 seconds");
        await sleep(5000);
        break;
      } else {
        core.info("The VM is booting, please wait....");
      }

    }

    let cmd1 = "mkdir -p /Users/runner/work && ln -s /Users/runner/work/  work";
    await execSSH(cmd1, "Setting up VM");

    let cmd2 = "pkg  install  -y fusefs-sshfs && kldload  fuse.ko && sshfs -o allow_other,default_permissions runner@10.0.2.2:work /Users/runner/work";
    await execSSH(cmd2, "Setup sshfs");

    core.info("OK, Ready!");

  }
  catch (error) {
    core.setFailed(error.message);
  }
}





async function main() {
  let nat = core.getInput("nat");
  core.info("nat: "+ nat);
  core.info("nat json: "+ JSON.stringify(nat));

  await setup(nat);

  var envs = core.getInput("envs");
  console.log("envs:" + envs);
  if (envs) {
    fs.appendFileSync(path.join(process.env["HOME"] , "/.ssh/config"), "SendEnv " + envs + "\n");
  }

  var prepare = core.getInput("prepare");
  if(prepare) {
    core.info("Running prepare: " + prepare);
    await exec.exec("ssh -t -p 2222 root@localhost", [], {input: prepare});
  }

  var run = core.getInput("run");
  console.log("run: " + run);

  try {
    run = 'cd "$GITHUB_WORKSPACE" && ' + run;
    await execSSH(run);
  } catch (error) {
    core.setFailed(error.message);
  }
}



main().catch(ex => {
  core.setFailed(ex.message);
});

