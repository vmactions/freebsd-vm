# Run GitHub CI in FreeBSD

Use this action to run your CI in FreeBSD.

The github workflow only supports Ubuntu, Windows and MacOS. But what if you need a FreeBSD?

This action is to support FreeBSD.


Sample workflow `freebsd.yml`:

```yml

name: Test

on: [push]

jobs:
  testfreebsd:
    runs-on: macos-latest
    name: A job to run test FreeBSD
    env:
      MYTOKEN : ${{ secrets.MYTOKEN }}
      MYTOKEN2: "value2"
    steps:
    - uses: actions/checkout@v2
    - name: Test in FreeBSD
      id: test
      uses: vmactions/freebsd-vm@v0.0.3
      with:
        envs: 'MYTOKEN MYTOKEN2'
        prepare: pkg install -y curl
        nat:
        - "8080": "80"
        - "8443": "443"
        run: |
          pwd
          ls -lah
          whoami
          env
          freebsd-version



```


The `runs-on: macos-latest` must be `macos-latest`.

The `envs: 'MYTOKEN MYTOKEN2'` is the env names that you want to pass into freebsd vm.

The `run: xxxxx `  is the command you want to run in freebsd vm.

The env variables are all copied into the VM, and the source code and directory are all synchronized into the VM.



# Under the hood

GitHub only supports Ubuntu, Windows and MacOS out of the box. 

However, the MacOS support virtualization. It has VirtualBox installed.

So, we run the FreeBSD VM in VirbualBox on MacOS.










