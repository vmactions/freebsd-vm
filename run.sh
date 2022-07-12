#!/usr/bin/env bash

set -e

OVA_LINK="https://github.com/vmactions/freebsd-builder/releases/download/v0.1.0/freebsd-13.1.ova.7z"

CONF_LINK="https://raw.githubusercontent.com/vmactions/freebsd-builder/main/conf/freebsd-13.1.conf"


_script="$0"
_script_home="$(dirname "$_script")"


#everytime we cd to the script home
cd "$_script_home"


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
ovazip="$ova.7z"

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


}







"$@"






















