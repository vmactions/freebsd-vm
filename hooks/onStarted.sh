#!/usr/bin/env sh
#run in the vm as soon as the vm is started, before run the "prepare"

# try to print some diognostic info (but don't fail here): OS, VM specs, VM date, VM user
# FreeBSD version
freebsd-version || true
# VM specs
uname -r -p -m -s 2>/dev/null || uname 2>/dev/null || true
# VM's date
date -u || true
# User login diognostics
printf '%s\n' "Running as user:" || true
whoami 2>/dev/null || who -m 2>/dev/null || true
printf '%s\n' "Home: ${HOME:-.}" || true

# loade fuse filesystem kernel module (if able)
if ! kldload  fusefs 2>/dev/null; then
  #ok, kldload: can't load fusefs: module already loaded or in kernel 
  printf "\n" # retrun fast
fi

#switch to latest source
#just for the old images, before 13.5, 14.3 and 15.0.
if grep "quarterly" /etc/pkg/FreeBSD.conf; then
  sed -i '' 's#/quarterly#/latest#g' /etc/pkg/FreeBSD.conf
  rm -rf /var/db/pkg/repos/*
  cat /etc/pkg/FreeBSD.conf ;
fi

# add additional hooks here



# TODO: should exit here to cleanup
