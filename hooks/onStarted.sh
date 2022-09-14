#!/usr/bin/env sh

#run in the vm as soon as the vm is started, before run the "prepare"

service ntpd enable

service ntpd start

freebsd-version

date -u











