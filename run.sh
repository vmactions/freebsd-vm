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


confname=$VM_RELEASE


if [ "$VM_ARCH" = "x86_64" ] || [ "$VM_ARCH" = "amd64" ]; then
  VM_ARCH=""
fi

if [ "$VM_ARCH" = "arm64" ]; then
  VM_ARCH="aarch64"
fi

if [ "$VM_ARCH" ]; then
  confname=$VM_RELEASE-$VM_ARCH
fi


#load the release conf
if [ ! -e "conf/$confname.conf" ]; then
  echo "Can not find release conf: conf/$confname.conf"
  echo "The supported release conf: "
  ls conf/*
  exit 1
fi


. conf/$confname.conf


#load the vm conf
_conf_filename="$(echo "$CONF_LINK" | rev  | cut -d / -f 1 | rev)"
echo "Config file: $_conf_filename"

if [ ! -e "$_conf_filename" ]; then
  wget -q "$CONF_LINK"
fi

#load the builder conf
. $_conf_filename


#reload the local vm conf again, in case the vm conf can override values in the builder conf
. conf/$confname.conf


export VM_ISO_LINK
export VM_OS_NAME
export VM_RELEASE
export VM_INSTALL_CMD
export VM_SSHFS_PKG
export VM_NFS_CMD
export VM_LOGIN_TAG
export VM_OCR
export VM_DISK
export VM_ARCH

##########################################################


vmsh="$VM_VBOX"

if [ ! -e "$vmsh" ]; then
  echo "Downloading vbox ${SEC_VBOX:-$VM_VBOX_LINK} to: $PWD"
  wget -O $vmsh "${SEC_VBOX:-$VM_VBOX_LINK}"
fi

_endswith() {
  _str="$1"
  _sub="$2"
  echo "$_str" | grep -- "$_sub\$" >/dev/null 2>&1
}

osname="$VM_OS_NAME"
ostype="$VM_OS_TYPE"
sshport=$VM_SSH_PORT


ovafile="$(echo "$OVA_LINK" | rev  | cut -d / -f 1 | rev)"
qow2="$(echo "$OVA_LINK" | rev  | cut -d / -f 1 | cut -d . -f 2- | rev)"


_idfile='~/.ssh/host.id_rsa'


check_url_exists() {
  url=$1
  http_status=$(curl -o /dev/null --silent --head --write-out '%{http_code}' "$url")
  if [[ "$http_status" -ge 200 && "$http_status" -lt 400 ]]; then
    return 0
  else
    return 1
  fi
}


importVM() {
  _mem=$1
  _cpu=$2

  bash $vmsh setup

  if [ ! -e "$qow2" ]; then
    echo "Downloading $OVA_LINK"
    axel -n 8 -o "$ovafile" -q "$OVA_LINK"
    
    for i in $(seq 1 9) ; do
      _url="${OVA_LINK}.$i"
      echo "Checking $_url"
      if ! check_url_exists "$_url"; then
        echo "break"
        break
      fi
      axel -n 8 -o "${ovafile}.$i" -q "$_url"
      ls -lah
      cat "${ovafile}.$i" >>"$ovafile"
      rm -f "${ovafile}.$i"
    done
    ls -lah

    echo "Download finished, extracting"
    if _endswith "$OVA_LINK" ".xz"; then
      #just to keep compatible with the old xz editions
      xz -v -d $ovafile
    else
      zstd -d "$ovafile" -o "$qow2"
      rm -f "$ovafile"
    fi
    echo "Extract finished"
    ls -lah
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

  bash $vmsh importVM $osname $ostype "$qow2"   ""    "$_mem"  "$_cpu"

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
  exec ssh "$osname" sh -e
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


startVM() {
  bash $vmsh startVM "$osname"
}



rsyncToVM() {
  _pwd="$PWD"
  cd "$_oldPWD"
  rsync -avrtopg -e 'ssh -o MACs=umac-64-etm@openssh.com' --exclude _actions --exclude _PipelineMapping  $HOME/work/  $osname:work
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
if ! command -v rsync; then
$VM_INSTALL_CMD $VM_RSYNC_PKG
fi
EOF

}

runSSHFSInVM() {

  if [ -e "hooks/onRunSSHFS.sh" ] && ssh "$osname" sh <hooks/onRunSSHFS.sh; then
    echo "OK";
  elif [ "$VM_SSHFS_PKG" ]; then
    echo "Installing $VM_SSHFS_PKG"
    ssh "$osname" sh <<EOF
if ! command -v sshfs ; then
$VM_INSTALL_CMD $VM_SSHFS_PKG
fi
EOF
    echo "Run sshfs"
    ssh "$osname" sh <<EOF

if sshfs -o reconnect,ServerAliveCountMax=2,allow_other,default_permissions host:work $HOME/work ; then
  echo "run sshfs in vm is OK, show mount:"
  /sbin/mount
  if [ "$osname" = "netbsd" ]; then
    tree $HOME/work
  fi
else
  echo "error run sshfs in vm."
  exit 1
fi

EOF

  fi


}

runNFSInVM() {
  echo "Installing NFS on host"
  sudo apt-get install -y nfs-kernel-server
  echo "$HOME/work *(rw,insecure,async,no_subtree_check,anonuid=$(id -u),anongid=$(id -g))" | sudo tee -a /etc/exports
  sudo exportfs -a

  if [ -e "hooks/onRunNFS.sh" ] && ssh "$osname" env "RUNNER_HOME=$HOME" sh <hooks/onRunNFS.sh; then
    echo "OK";
  elif [ "$VM_NFS_CMD" ]; then
    echo "Configuring NFS in VM"
    ssh "$osname" sh <<EOF
$VM_NFS_CMD
EOF
    echo "Done with NFS"
  else
    echo "Configuring NFS in VM with default command"
    ssh "$osname" sh <<EOF
if [ -e "/sbin/mount" ]; then
/sbin/mount 192.168.122.1:$HOME/work \$HOME/work
else
mount 192.168.122.1:$HOME/work \$HOME/work
fi

EOF
    echo "Done with NFS"
  fi
}


#run in the vm, just as soon as the vm is up
onStarted() {
  bash $vmsh addSSHHost $osname "$_idfile"
  #just touch the file, so that the user can access this file in the VM
  if [ "${GITHUB_ENV}" ]; then
    echo "" >>${GITHUB_ENV}
  fi
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
  bash -c 'pwd && ls -lah ~/.ssh/'
  if [ -e "$HOME/.ssh/config" ]; then
    cat "$HOME/.ssh/config"
  fi
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
















