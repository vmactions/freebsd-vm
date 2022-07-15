#!/usr/bin/env bash

set -e


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


##########################################################


export VM_OS_NAME

vmsh="$VM_VBOX"

if [ ! -e "$vmsh" ]; then
  echo "Downloading vbox to: $PWD"
  wget "$VM_VBOX_LINK"
fi



osname="$VM_OS_NAME"
ostype="$VM_OS_TYPE"
sshport=$VM_SSH_PORT

ova="$VM_OVA_NAME.ova"

ovazip="$(echo "$OVA_LINK" | rev  | cut -d / -f 1 | rev)"


ovafile="$ova"



importVM() {
  _idfile='~/.ssh/mac.id_rsa'

  bash $vmsh addSSHHost $osname $sshport "$_idfile"

  bash $vmsh setup

  if [ ! -e "$ovazip" ]; then
    echo "Downloading $OVA_LINK"
    wget -q "$OVA_LINK"
  fi

  if [ ! -e "$ovafile" ]; then
    7za e -y $ovazip  -o.
  fi

  bash $vmsh addSSHAuthorizedKeys id_rsa.pub
  cat mac.id_rsa >$HOME/.ssh/mac.id_rsa
  chmod 600 $HOME/.ssh/mac.id_rsa

  bash $vmsh importVM "$ovafile"

  if [ "$DEBUG" ]; then
    bash $vmsh startWeb $osname
    bash $vmsh startCF
  fi

}



waitForLoginTag() {
  bash $vmsh waitForText "$osname" "$VM_LOGIN_TAG"
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
  bash $vmsh addNAT "$osname" "$@"
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
  rsync -auvzrtopg  --exclude _actions/vmactions/$osname-vm  /Users/runner/work/  $osname:work
  cd "$_pwd"
}


rsyncBackFromVM() {
  _pwd="$PWD"
  cd "$_oldPWD"
  rsync -uvzrtopg  $osname:work/ /Users/runner/work
  cd "$_pwd"
}


installRsyncInVM() {
  ssh "$osname" "$VM_INSTALL_CMD $VM_RSYNC_PKG"
}

runSSHFSInVM() {
  ssh "$osname" "$VM_INSTALL_CMD $VM_SSHFS_PKG && sshfs -o allow_other,default_permissions runner@10.0.2.2:work /Users/runner/work"
}



"$@"






















