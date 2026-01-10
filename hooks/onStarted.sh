#!/usr/bin/env sh

#run in the vm as soon as the vm is started, before run the "prepare"

service ntpd enable

service ntpd start

freebsd-version

date -u

if ! kldload  fusefs ; then
  #ok, kldload: can't load fusefs: module already loaded or in kernel 
  echo ""
fi

#switch to latest source
#just for the old images, before 13.5, 14.3 and 15.0.
if grep "quarterly" /etc/pkg/FreeBSD.conf; then
  sed -i '' 's#/quarterly#/latest#g' /etc/pkg/FreeBSD.conf
  rm -rf /var/db/pkg/repos/*
fi










