#!/bin/sh

echo "====> Wait for Boot Multi user"
try_counter=0
while ! bash vbox.sh waitForText "$VM_OS_NAME" "Boot Multi user" 10 ; do
  if [ "$try_counter" -ge 10 ] ; then
    echo "====> Too many tries... exiting."
    exit 1
  fi
  echo "====> Timed out, trying again..."
  try_counter=$((1+try_counter))
  sleep 1
done

echo "====> OK, enter"
bash vbox.sh enter
