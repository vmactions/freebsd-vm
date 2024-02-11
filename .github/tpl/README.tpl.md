# Run GitHub CI in {{VM_NAME}} ![Test](https://github.com/{{GITHUB_REPOSITORY}}/workflows/Test/badge.svg)

Use this action to run your CI in {{VM_NAME}}.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need to use {{VM_NAME}}?

This action is to support {{VM_NAME}}.


Sample workflow `test.yml`:

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
    - uses: actions/checkout@v4
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

The code is shared from the host to the VM via `rsync` by default, you can choose to use to `sshfs` share code instead.


```

...

    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        sync: sshfs
        prepare: |
          {{VM_PREPARE}}



...


```

You can also set `sync: no`, so the files will not be synced to the  VM.


When using `rsync`,  you can define `copyback: false` to not copy files back from the VM in to the host.


```

...

    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        sync: rsync
        copyback: false
        prepare: |
          {{VM_PREPARE}}



...


```



You can add NAT port between the host and the VM.

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        nat: |
          "8080": "80"
          "8443": "443"
          udp:"8081": "80"
...
```


The default memory of the VM is 6144MB, you can use `mem` option to set the memory size:

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        envs: 'MYTOKEN MYTOKEN2'
        usesh: true
        mem: 4096
...
```



It uses [the {{VM_NAME}} {{DEFAULT_RELEASE}}](conf/default.release.conf) by default, you can use `release` option to use another version of {{VM_NAME}}:

```
...
    steps:
    - uses: actions/checkout@v4
    - name: Test
      id: test
      uses: {{GITHUB_REPOSITORY}}@{{LATEST_MAJOR}}
      with:
        release: "{{VM_SET_RELEASE}}"
...
```

All the supported releases are here: {{VM_NAME}}  {{ALL_RELEASES}} [See all here](conf)


# Under the hood

We use Qemu and Libvirt to run the {{VM_NAME}} VM.




# Upcoming features:

1. Runs on MacOS to use cpu accelaration.
2. Support ARM and other architecture.




