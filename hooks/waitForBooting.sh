


echo "====> Wait for Boot Multi user"
if bash vbox.sh waitForText $VM_OS_NAME "Boot Multi user" 10 ; then
  echo "====> OK, enter"
  bash vbox.sh enter
fi



