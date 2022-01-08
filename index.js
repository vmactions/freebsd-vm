const core = require('@actions/core')
const exec = require('@actions/exec')
const tc = require('@actions/tool-cache')
const io = require('@actions/io')
const fs = require('fs')
const net = require('net')
const path = require('path')

let vmName = "FreeBSD"

class VirtualMachine {
    constructor() {
        this.run = core.getInput("run")
        this.version = core.getInput('version')
        this.envs = core.getInput("envs")
        this.memory = core.getInput("memory")
        this.nat = core.getInput("nat")
        this.prepare = core.getInput("prepare")
        this.shell = this.getDesiredShell()
        this.sync = core.getInput("sync")

        if (this.envs) {
            fs.appendFileSync(path.join(process.env["HOME"], `/.ssh/config`), `  SendEnv ${this.envs}`);
        }
    }

    getDesiredShell() {
        let useSH = core.getInput("usesh").toLowerCase() === "true"
        if (useSH) {
            return `sh`
        } else {
            return `$SHELL`
        }
    }

    printInformation() {
        console.log(`FreeBSD version: ${this.version}`)
        console.log(`Memory: ${this.memory}`)

        console.log(`Run command(s): ${this.run}`)

        console.log(`*** Optional parameters ***`)
        console.log(`Prepare Statement: ${this.prepare}`)
        console.log(`Additional environment variables: ${this.envs}`)
        console.log(`NAT: ${this.nat}`)
        console.log(`Used Shell: ${this.shell}`)
    }

    async runCommand() {
        await exec.exec(`ssh FreeBSD sh -c 'cd $GITHUB_WORKSPACE && exec ${this.shell}'`, [], {input: this.run})
    }
}


async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function execSSH(cmd) {
    console.info(cmd)
    var output = ""
    await exec.exec(`ssh -t ${vmName}`, [], {
        input: cmd,
        listeners: {
            stdout: (s) => {
                output += s
            }
        }
    })
    console.info(output)
}

function isSSHReachable(port) {;
    return new Promise(function (resolve, reject) {
        let timer = setTimeout(function () {
            reject("timeout");
            socket.end();
        }, 2000);
        let socket = net.createConnection(port, 'localhost', function () {
            clearTimeout(timer);
            resolve();
            socket.destroy();
        })
        socket.on('error', function (err) {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function waitFor(port) {
    var machineNotReady = true

    let slept = 0;
    while (machineNotReady) {
        slept += 1;
        if (slept >= 300) {
            throw new Error("Timeout can not boot");
        }
        await sleep(5000);

        isSSHReachable(port).then(function () {
            console.info("VM is now up & running")
            sleep(1000);
            machineNotReady = false
        }, function (err) {
            console.error("Checking, please wait....")
        })
    }
}

async function vboxmanage(cmd, args = "") {
    await exec.exec("sudo  vboxmanage " + cmd + "   " + vmName + "   " + args);
}

async function setup(version, nat, mem) {
    try {

        let port = 2222

        let config_file = path.join(process.env["HOME"], "/.ssh/config")

        let ssh_config = `
    Host FreeBSD
      User root
      HostName localhost;
      Port ${port}
      StrictHostKeyChecking=accept-new
      IdentityFile ~/.ssh/id_ed25519
      SendEnv   CI  GITHUB_*
    `

        console.log(`create SSH configuration file '${config_file}' with content:`)
        console.log(` ${ssh_config}`)
        fs.appendFileSync(config_file, ssh_config)

        let workingDir = __dirname;

        let url = `https://github.com/os-runners/freebsd-builder/releases/latest/download/freebsd-${version}.tar.xz`;

        console.info("Downloading image: " + url);
        let img = await tc.downloadTool(url);
        console.info("Downloaded file: " + img);

        let vmArchive = workingDir + `/freebsd-${version}.tar.xz`;
        await io.mv(img, vmArchive);
        await exec.exec(`tar -xf ${vmArchive} -C ${workingDir}`);

        let sshHome = path.join(process.env["HOME"], ".ssh");
        await exec.exec(`mv ${workingDir}/id_ed25519 ${sshHome}/id_ed25519`);
        await exec.exec(`chmod 0600 ${sshHome}/id_ed25519`);

        await exec.exec("chmod 700 " + sshHome);

        let ova = `freebsd-${version}.ova`;
        await vboxmanage("", "import", path.join(workingDir, ova));

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
                    await vboxmanage("modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");

                } else if (segs.length === 2) {
                    let proto = "tcp"
                    let hostPort = segs[0].trim().trim('"');
                    let vmPort = segs[1].trim().trim('"');
                    await vboxmanage("modifyvm", "  --natpf1 '" + hostPort + "," + proto + ",," + hostPort + ",," + vmPort + "'");
                }
            }
        }

        if (mem) {
            await vboxmanage("modifyvm", "  --memory " + mem);
        }

        await vboxmanage("modifyvm", " --cpus 3");

        await vboxmanage("startvm", " --type headless");

        console.info("First boot");

        await waitFor(port);

        try {
            console.info(`Sync FreeBSD time`)
            await execSSH(`ntpdate -v -b pool.ntp.org || ntpdate -v -b us.pool.ntp.org || ntpdate -v -b asia.pool.ntp.org`)
        } catch (ex) {
            console.info("can not sync time")
        }
        let cmd1 = "mkdir -p /Users/runner/work && ln -s /Users/runner/work/  work";
        console.info(`Setting up VM`)
        await execSSH(cmd1)

        let sync = core.getInput("sync");
        if (sync == "sshfs") {

            let cmd2 = "pkg  install  -y fusefs-sshfs && kldload  fusefs && sshfs -o allow_other,default_permissions runner@10.0.2.2:work /Users/runner/work";
            console.info(`Setup sshfs`)
            await execSSH(cmd2);
        } else {
            await exec.exec("rsync -auvzrtopg  --exclude _actions/os-runners/freebsd-vm/*  /Users/runner/work/ FreeBSD:work");
        }

        console.info("OK, Ready!");

    } catch (error) {
        core.setFailed(error.message);
    }
}


async function main() {
    let vm = new VirtualMachine()
    vm.printInformation()

    await setup(vm.version, vm.nat, vm.memory);

    if (vm.prepare) {
        console.info("Running prepare: " + prepare);
        await exec.exec("ssh -t FreeBSD", [], {input: prepare });
    }

    try {
        await vm.runCommand()
    } catch (error) {
        core.setFailed(error.message);
    } finally {
        if (vm.sync !== "sshfs") {
            console.info("get back by rsync");
            await exec.exec("rsync -uvzrtopg  FreeBSD:work/ /Users/runner/work");
        }
    }
}

main().catch(ex => {
    core.setFailed(ex.message);
})

