


echo "====> Wait for Boot Options"
if bash vbox.sh waitForText $VM_OS_NAME "Boot Options" 5 ; then
  echo "====> OK, enter"
  bash vbox.sh enter
fi



