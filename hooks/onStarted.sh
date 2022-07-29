#run in the vm as soon as the vm is started, before run the "prepare"




ntpdate -b pool.ntp.org || (sleep 2; ntpdate -b us.pool.ntp.org )|| ( sleep 2; ntpdate -b asia.pool.ntp.org) || (sleep 2; ntpdate -b 0.ubuntu.pool.ntp.org)



