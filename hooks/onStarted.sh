#run in the vm as soon as the vm is started, before run the "prepare"


for i in $(seq 1 10); do 
  echo "Try ntpdate... $1"
  if ntpdate -b pool.ntp.org || (sleep 2; ntpdate -b us.pool.ntp.org )|| ( sleep 2; ntpdate -b asia.pool.ntp.org) || (sleep 2; ntpdate -b 0.ubuntu.pool.ntp.org); then
    echo "ntpdate OK"
    break;
  fi
done





