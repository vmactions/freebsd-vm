# Run GitHub CI in FreeBSD 
![Test](https://github.com/vmactions/freebsd-vm/workflows/Test/badge.svg)

[![SonarCloud](https://sonarcloud.io/images/project_badges/sonarcloud-black.svg)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)

[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)

[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=bugs)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=coverage)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=os-runners_freebsd-vm&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=os-runners_freebsd-vm)

Use this action to run your CI in FreeBSD.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need a FreeBSD?

This action is to support FreeBSD.


Sample workflow `freebsd.yml`:

```yaml

name: Test

on: [push]

jobs:
  testfreebsd:
    runs-on: macos-10.15
    name: A job to run test FreeBSD
    env:
      MYTOKEN : ${{ secrets.MYTOKEN }}
      MYTOKEN2: "value2"
    steps:
    - uses: actions/checkout@v2
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v0.1.5
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        prepare: pkg install -y curl
        run: |
          pwd
          ls -lah
          whoami
          env
          freebsd-version



```


The `runs-on: macos-10.15` must be `macos-10.15`.

The `envs: 'MYTOKEN MYTOKEN2'` is the env names that you want to pass into freebsd vm.

The `run: xxxxx`  is the command you want to run in freebsd vm.

The env variables are all copied into the VM, and the source code and directory are all synchronized into the VM.

The working dir for `run` in the VM is the same as in the Host machine.

All the source code tree in the Host machine are mounted into the VM.

All the `GITHUB_*` as well as `CI=true` env variables are passed into the VM.

So, you will have the same directory and same default env variables when you `run` the CI script.

The default shell in FreeBSD is `csh`, if you want to use `sh` to execute the `run` script, please set `usesh` to `true`.

The code is shared from the host to the FreeBSD VM via `rsync`, you can choose to use to `sshfs` share code instead.


```yaml

...

    steps:
    - uses: actions/checkout@v2
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v0.1.5
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        sync: sshfs
        prepare: pkg install -y curl



...


```

You can add NAT port between the host and the VM.

```yaml
...
    steps:
    - uses: actions/checkout@v2
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v0.1.5
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        nat: |
          "8080": "80"
          "8443": "443"
          udp:"8081": "80"
...
```


The default memory of the VM is 8192MB, you can use `mem` option to set the memory size:

```yaml
...
    steps:
    - uses: actions/checkout@v2
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v0.1.5
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        mem: 2048
...
```


# Under the hood

GitHub only supports Ubuntu, Windows and MacOS out of the box.

However, the MacOS support virtualization. It has VirtualBox installed.

So, we run the FreeBSD VM in VirtualBox on MacOS.
