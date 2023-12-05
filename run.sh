#!/usr/bin/env bash

set -e

export PATH=$PATH:/Library/Frameworks/Python.framework/Versions/Current/bin

_script="$0"
_script_home="$(dirname "$_script")"


_oldPWD="$PWD"
#everytime we cd to the script home
cd "$_script_home"



#find the release number
if [ -z "$VM_RELEASE" ]; then
  if [ ! -e "conf/default.release.conf" ]; then
    echo "The VM_RELEASE is empty,  but the conf/default.release.conf is not found. something wrong."
    exit 1
  fi
  . "conf/default.release.conf"
  VM_RELEASE=$DEFAULT_RELEASE
fi

export VM_RELEASE


#load the release conf
if [ ! -e "conf/$VM_RELEASE.conf" ]; then
  echo "Can not find release conf: conf/$VM_RELEASE.conf"
  echo "The supported release conf: "
  ls conf/*
  exit 1
fi


. conf/$VM_RELEASE.conf


#load the vm conf
_conf_filename="$(echo "$CONF_LINK" | rev  | cut -d / -f 1 | rev)"
echo "Config file: $_conf_filename"

if [ ! -e "$_conf_filename" ]; then
  wget -q "$CONF_LINK"
fi

. $_conf_filename

export VM_ISO_LINK
export VM_OS_NAME
export VM_RELEASE
export VM_INSTALL_CMD
export VM_SSHFS_PKG
export VM_LOGIN_TAG
export VM_OCR
export VM_DISK

##########################################################


vmsh="$VM_VBOX"

if [ ! -e "$vmsh" ]; then
  echo "Downloading vbox ${SEC_VBOX:-$VM_VBOX_LINK} to: $PWD"
  wget -O $vmsh "${SEC_VBOX:-$VM_VBOX_LINK}"
fi



osname="$VM_OS_NAME"
ostype="$VM_OS_TYPE"
sshport=$VM_SSH_PORT

ovafile="$osname-$VM_RELEASE.qcow2.xz"

_idfile='~/.ssh/host.id_rsa'

importVM() {

  bash $vmsh setup

  if [ ! -e "$ovafile" ]; then
    echo "Downloading $OVA_LINK"
    axel -n 8 -o "$ovafile" -q "$OVA_LINK"
    echo "Download finished, extract"
    xz -d $ovafile
    echo "Extract finished"
  fi

  if [ ! -e "id_rsa.pub" ]; then
    echo "Downloading $VM_PUBID_LINK"
    wget -O "id_rsa.pub" -q "$VM_PUBID_LINK"
  fi

  if [ ! -e "host.id_rsa" ]; then
    echo "Downloading $HOST_ID_LINK"
    wget -O "host.id_rsa" -q "$HOST_ID_LINK"
  fi

  ls -lah

  bash $vmsh addSSHAuthorizedKeys id_rsa.pub
  cat host.id_rsa >$HOME/.ssh/host.id_rsa
  chmod 600 $HOME/.ssh/host.id_rsa

  bash $vmsh importVM $osname $ostype "$osname-$VM_RELEASE.qcow2"

  if [ "$DEBUG" ]; then
    bash $vmsh startWeb $osname
  fi

}



waitForVMReady() {
  bash $vmsh waitForVMReady "$osname"
}


#using the default ksh
execSSH() {
  exec ssh "$osname"
}

#using the sh 
execSSHSH() {
  exec ssh "$osname" sh
}


addNAT() {
  _prot="$1"
  _hostport="$2"
  _vmport="$3"
  _vmip=$(bash $vmsh getVMIP "$osname")
  echo "vm ip: $_vmip"
  if ! command -v socat; then
    echo "installing socat"
    if bash $vmsh isLinux; then
      sudo apt-get install -y socat
    else
      brew install socat
    fi
  fi

  if [ "$_prot" == "udp" ]; then
    sudo socat UDP4-RECVFROM:$_hostport,fork UDP4-SENDTO:$_vmip:$_vmport >/dev/null 2>&1 &
  else
    sudo socat TCP-LISTEN:$_hostport,fork TCP:$_vmip:$_vmport >/dev/null 2>&1 &
  fi

}

setMemory() {
  bash $vmsh setMemory "$osname" "$@"
}

setCPU() {
  bash $vmsh setCPU "$osname" "$@"
}

startVM() {
  bash $vmsh startVM "$osname"
}



rsyncToVM() {
  _pwd="$PWD"
  cd "$_oldPWD"
  rsync -avrtopg -e 'ssh -o MACs=umac-64-etm@openssh.com' --exclude _actions --exclude _PipelineMapping --exclude _temp  $HOME/work/  $osname:work
  cd "$_pwd"
}


rsyncBackFromVM() {
  _pwd="$PWD"
  cd "$_oldPWD"
  rsync -vrtopg   -e 'ssh -o MACs=umac-64-etm@openssh.com' $osname:work/ $HOME/work
  cd "$_pwd"
}


installRsyncInVM() {
  ssh "$osname" sh <<EOF

$VM_INSTALL_CMD $VM_RSYNC_PKG

EOF

}

runSSHFSInVM() {

  if [ -e "hooks/onRunSSHFS.sh" ] && ssh "$osname" sh <hooks/onRunSSHFS.sh; then
    echo "OK";
  elif [ "$VM_SSHFS_PKG" ]; then
    echo "Installing $VM_SSHFS_PKG"
    ssh "$osname" sh <<EOF

$VM_INSTALL_CMD $VM_SSHFS_PKG

EOF
    echo "Run sshfs"
    ssh "$osname" sh <<EOF

sshfs -o reconnect,ServerAliveCountMax=2,allow_other,default_permissions host:work $HOME/work

EOF

  fi


}


#run in the vm, just as soon as the vm is up
onStarted() {
  bash $vmsh addSSHHost $osname "$_idfile"
  if [ -e "hooks/onStarted.sh" ]; then
    ssh "$osname" sh <hooks/onStarted.sh
  fi
}


#run in the vm, just after the files are initialized
onInitialized() {
  if [ -e "hooks/onInitialized.sh" ]; then
    ssh "$osname" sh <hooks/onInitialized.sh
  fi
}


onBeforeStartVM() {
  #run in the host machine, the VM is imported, but not booted yet.
  if [ -e "hooks/onBeforeStartVM.sh" ]; then
    echo "Run hooks/onBeforeStartVM.sh"
    . hooks/onBeforeStartVM.sh
  else
    echo "Skip hooks/onBeforeStartVM.sh"
  fi
}


showDebugInfo() {
  echo "==================Debug Info===================="
  pwd && ls -lah && sudo ps aux
  bash -c 'pwd && ls -lah ~/.ssh/ && [ -e "~/.ssh/config" ] && cat ~/.ssh/config'
  cat $_conf_filename

  echo "===================Debug Info in VM============="
  ssh "$osname" sh <<EOF
pwd
ls -lah
whoami
tree .

EOF
  echo "================================================"

}

"$@"






















