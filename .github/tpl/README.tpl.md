# Run GitHub CI in {{VM_NAME}} ![Test](https://github.com/{{GITHUB_REPOSITORY}}/workflows/Test/badge.svg)

Powered by [AnyVM.org](https://anyvm.org)

Use this action to run your CI in {{VM_NAME}}.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need to use {{VM_NAME}}?


All the supported releases are here:

{{RELEASE_TABLE}}




## 1. Example: `test.yml`:

```yml

name: Test

on: [push]

jobs:
  test:
    runs-on: {{VM_RUNS_ON}}
    name: A job to run test in {{VM_NAME}}
    env:
      MYTOKEN : ${{ secrets.MYTOKEN }}
      MYTOKEN2: "value2"
    steps:
    - uses: actions/checkout@v6
    - name: Test in {{VM_NAME}}
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        prepare: |
          {{VM_PREPARE}}

        run: |
{{VM_RUN}}




```


The latest major version is: `{{LATEST_MAJOR}}`, which is the most recommended to use. (You can also use the latest full version: `{{LATEST_TAG}}`)  


If you are migrating from the previous `v0`, please change the `runs-on: ` to `runs-on: {{VM_RUNS_ON}}`


The `envs: 'MYTOKEN MYTOKEN2'` is the env names that you want to pass into the vm.

The `run: xxxxx`  is the command you want to run in the vm.

The env variables are all copied into the VM, and the source code and directory are all synchronized into the VM.

The working dir for `run` in the VM is the same as in the Host machine.

All the source code tree in the Host machine are mounted into the VM.

All the `GITHUB_*` as well as `CI=true` env variables are passed into the VM.

So, you will have the same directory and same default env variables when you `run` the CI script.

{{VM_SHELL_COMMENTS}}



## 2. Share code

The code is shared from the host to the VM via `rsync` by default, you can choose to use `sshfs` or `nfs` or `scp` to share code instead.


```yaml

...

    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
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
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        sync: rsync
        copyback: false


...


```


{{VM_SYNC_COMMENTS}}


## 3. NAT from host runner to the VM

You can add NAT port between the host and the VM.

```yaml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
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
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        mem: 4096
...
```


The VM is using all the cpu cores of the host by default, you can use `cpu` option to change the cpu cores:

```yaml

...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        cpu: 3
...
```


## 5. Select release

It uses [the {{VM_NAME}} {{DEFAULT_RELEASE}}](conf/default.release.conf) by default, you can use `release` option to use another version of {{VM_NAME}}:

```yaml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        release: "{{VM_SET_RELEASE}}"
...
```


## 6. Select architecture

The vm is using x86_64(AMD64) by default, but you can use `arch` option to change the architecture:

```yaml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        arch: aarch64
...
```

When you run with `aarch64`, the host runner should still be the normal `x86_64` runner: `runs-on: {{VM_RUNS_ON}}`

It's not recommended to use `ubuntu-24.04-arm` as runner, it's much more slower.

{{VM_ARCH_COMMENTS}}

## 7. Custom shell

Support custom shell:

```yaml
...
    steps:
    - uses: actions/checkout@v6
    - name: Start VM
      id: vm
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        sync: nfs
    - name: Custom shell step 1
      shell: {{VM_OS_NAME}} {0}
      run: |
        cd $GITHUB_WORKSPACE;
        pwd
        echo "this is step 1, running inside the VM"
    - name: Custom shell step 2
      shell: {{VM_OS_NAME}} {0}
      run: |
        cd $GITHUB_WORKSPACE;
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
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        sync-time: true
...
```


## 9. Disable cache

By default, the action caches `apt` packages on the host and VM images/artifacts. You can use the `disableCache` option to disable this:

```yml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        disable-cache: true
...
```


## 10. Debug on error

If you want to debug the VM when the `prepare` or `run` step fails, you can set `debug-on-error: true`.

When a failure occurs, the action will enable a remote VNC link and wait for your interaction. You can then access the VM via VNC to debug. To continue or finish the action, you can run `touch ~/continue` inside the VM.

```yaml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        debug-on-error: true

...
```

You can also set the `vnc-password` parameter to set a custom password to protect the VNC link:

```yaml
...
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        debug-on-error: true
        vnc-password: ${{ secrets.VNC_PASSWORD }}

...
```

You will be asked to input the username and password when you access the VNC link. The username can be any string, the password is the value of the `vnc-password` parameter.


See more: [debug on error](https://github.com/vmactions/.github/wiki/debug%E2%80%90on%E2%80%90error)



# Under the hood

We use Qemu to run the {{VM_NAME}} VM.




# Upcoming features:

1. Support other architectures, eg: sparc64 or powerpc64.














