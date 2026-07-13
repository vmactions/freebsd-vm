# Run GitHub CI in FreeBSD 

![Test](https://github.com/vmactions/freebsd-vm/workflows/Test/badge.svg)



See all the supported VMs: [VMActions.org](https://vmactions.org)

Powered by [AnyVM.org](https://anyvm.org)

## :robot: AI Ready

> [!TIP]
> **You don't need to write this workflow by hand.**
>
> These VMs are now AI-ready. With the **[vmactions-ci skill](https://github.com/vmactions/vmactions-skill)**, an AI coding agent -- Claude Code, Codex, Copilot CLI, Gemini CLI, and others -- understands the full vmactions interface and writes the GitHub Actions CI for you, **automatically**.
>
> Just describe what you want in plain language, e.g. *"run my tests on FreeBSD"* or *"check that my project builds on FreeBSD aarch64"*, and the agent generates a correct, ready-to-commit `test.yml`. It will:
>
> - pick the right action, `release`, and `arch` for your target;
> - install your toolchain and dependencies in the `prepare` step;
> - forward your secrets and environment variables into the VM;
> - sync your source code in and back out; and
> - steer around the common footguns -- the per-OS default shell, the `riscv64` sync method, keeping `runs-on: ubuntu-latest` even for other arches, pinning the action version, and more.
>
> No need to memorize releases, architectures, package managers, or shells -- the agent handles it. Install the skill once and just ask.
>
> ### >> [Get the vmactions-ci skill](https://github.com/vmactions/vmactions-skill) <<

Use this action to run your CI in FreeBSD.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need to use FreeBSD?


All the supported releases are here:



| Release | x86_64  | aarch64(arm64) | riscv64  | powerpc64 |
|---------|---------|---------|-----------------|-----------|
| 15.1    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 15.0    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 14.4    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 14.3    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 14.2    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 14.1    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 14.0    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 13.5    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 13.4    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |     —[^rv-stub]    |  ✅ (nfs,scp)    |
| 13.3    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 13.2    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (rsync,scp,sshfs,nfs)    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |
| 12.4    |  ✅ (nfs,scp)    |  ✅ (nfs,scp)    |     —[^rv-none]    |     —[^ppc-panic]    |

[^rv-none]: riscv64 first became a FreeBSD release architecture in 13.0, so there is no 12.4 riscv64 image to build.
[^rv-stub]: The upstream 13.4 riscv64 `qcow2.xz` on the FreeBSD archive mirror is a broken 32-byte stub rather than a real disk image, so this target cannot be built.
[^ppc-panic]: FreeBSD 12.x powerpc64 panics in early boot under QEMU pseries -- its PAPR hash-MMU backend hard-requires 16 MiB large pages, which QEMU advertises only when guest RAM is backed by host huge pages. Reworked in FreeBSD 13.0, so 13.2+ powerpc64 build fine; 12.4 (EOL) is dropped.





## 1. Example: `test.yml`:

```yml

name: Test

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    name: A job to run test in FreeBSD
    env:
      MYTOKEN : ${{ secrets.MYTOKEN }}
      MYTOKEN2: "value2"
    steps:
    - uses: actions/checkout@v6
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        prepare: |
          

        run: |
          #pkg install -y curl
          pwd
          ls -lah
          whoami
          env
          freebsd-version
          uname -a
          #sysctl hw.model
          sysctl hw.ncpu
          sysctl hw.physmem
          sysctl hw.usermem






```


The latest major version is: `v1`, which is the most recommended to use. (You can also use the latest full version: `v1.5.0`)  


If you are migrating from the previous `v0`, please change the `runs-on: ` to `runs-on: ubuntu-latest`


The `envs: 'MYTOKEN MYTOKEN2'` is the env names that you want to pass into the vm.

The `run: xxxxx`  is the command you want to run in the vm.

The env variables are all copied into the VM, and the source code and directory are all synchronized into the VM.

The working dir for `run` in the VM is the same as in the Host machine.

All the source code tree in the Host machine are mounted into the VM.

All the `GITHUB_*` as well as `CI=true` env variables are passed into the VM.

So, you will have the same directory and same default env variables when you `run` the CI script.

The default shell in FreeBSD(before 14.0) is `tcsh`, if you want to use `sh` to execute the `run` script, please set `usesh` to `true`.  https://docs.freebsd.org/en/articles/linux-users/#shells



## 2. Share code

The code is shared from the host to the VM via `rsync` by default, you can choose to use `sshfs` or `nfs` or `scp` to share code instead.


```yaml

...

    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        sync: sshfs  # or: nfs


...


```

You can also set `sync: no`, so the files will not be synced to the  VM.


When using `rsync` or `scp`,  you can define `copyback: false` to not copy files back from the VM in to the host.


```yaml

...

    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        sync: rsync
        copyback: false


...


```




Becareful: 

If you use `arch: riscv64`, you can only use `sync: scp` for now.






## 3. NAT from host runner to the VM

You can add NAT port between the host and the VM.

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        nat: |
          "8080": "80"
          "8443": "443"
          udp:"8081": "80"
...
```


## 4. Set memory and cpu

The default memory of the VM is 6144MB, you can use `mem` option to set the memory size:

```yaml

...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        mem: 4096
...
```


The VM is using all the cpu cores of the host by default, you can use `cpu` option to change the cpu cores:

```yaml

...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        cpu: 3
...
```


## 5. Select release

It uses [the FreeBSD 15.1](conf/default.release.conf) by default, you can use `release` option to use another version of FreeBSD:

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        release: "15.0"
...
```


## 6. Select architecture

The vm is using x86_64(AMD64) by default, but you can use `arch` option to change the architecture:

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        arch: aarch64
...
```

When you run with `aarch64`, the host runner should still be the normal `x86_64` runner: `runs-on: ubuntu-latest`

It's not recommended to use `ubuntu-24.04-arm` as runner, it's much more slower.



## 7. Custom shell

Support custom shell:

```yaml
...
    steps:
    - uses: actions/checkout@v6
    - name: Start VM
      id: vm
      uses: vmactions/freebsd-vm@v1
      with:
        sync: nfs
    - name: Custom shell step 1
      shell: freebsd {0}
      run: |
        pwd
        echo "this is step 1, running inside the VM"
    - name: Custom shell step 2
      shell: freebsd {0}
      run: |
        pwd
        echo "this is step 2, running inside the VM"
...
```

The custom shell will automatically `cd` into `$GITHUB_WORKSPACE` if it exists before running your commands.

How file changes propagate between the host and the VM depends on the `sync` method:

- `sync: nfs` or `sync: sshfs`: the workspace is a live mount, so file changes are visible on both sides immediately.
- `sync: rsync` or `sync: scp`: the wrapper syncs the workspace to the VM before each custom shell step and syncs it back afterwards, so files created in the VM are available to later host steps (and vice versa). `rsync` transfers are incremental; `scp` copies the whole workspace each time, which can be slow for large workspaces.

You can also use `custom-shell-name` to set a custom name for the shell wrapper:

```yaml
...
    steps:
    - uses: actions/checkout@v6
    - name: Start VM
      id: vm
      uses: vmactions/freebsd-vm@v1
      with:
        sync: nfs
        custom-shell-name: vmsh
    - name: Custom shell step 1
      shell: vmsh {0}
      run: |
        pwd
        echo "this is step 1, running inside the VM"
    - name: Custom shell step 2
      shell: vmsh {0}
      run: |
        pwd
        echo "this is step 2, running inside the VM"
...
```


## 8. Synchronize VM time

If the time in VM is not correct, You can use `sync-time` option to synchronize the VM time with NTP:

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        sync-time: true
...
```


## 9. Disable cache

By default, the action caches `apt` packages on the host and VM images/artifacts. You can use the `disable-cache` option to disable this:

```yml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        disable-cache: true
...
```


## 10. Debug on error

If you want to debug the VM when the `prepare` or `run` step fails, you can set `debug-on-error: true`.

When a failure occurs, the action will enable a remote VNC link and wait for your interaction. You can then access the VM via VNC to debug. To continue or finish the action, you can run `touch ~/continue` inside the VM.

[First create a variable `DEBUG_ON_ERROR` with value being "true"](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables),

Then use it in the workflow:

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        debug-on-error: ${{ vars.DEBUG_ON_ERROR }}

...
```

You can also set the `vnc-password` parameter to set a custom password to protect the VNC link:

```yaml
...
    - name: Test
      id: test
      uses: vmactions/freebsd-vm@v1
      with:
        debug-on-error: ${{ vars.DEBUG_ON_ERROR }}
        vnc-password: ${{ secrets.VNC_PASSWORD }}

...
```

You will be asked to input the username and password when you access the VNC link. The username can be any string, the password is the value of the `vnc-password` parameter.


See more: [debug on error](https://github.com/vmactions/.github/wiki/debug%E2%80%90on%E2%80%90error)



# Under the hood

We use Qemu to run the FreeBSD VM.




# Upcoming features:

1. Support MacOS runner and Windows runner.















