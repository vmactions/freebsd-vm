echo 'nfsuserd_enable="YES"' >> /etc/rc.conf
echo 'nfsuserd_flags="-domain srv.world"' >> /etc/rc.conf
mount -t nfs -o nfsv4 192.168.122.1:$RUNNER_HOME/work $RUNNER_HOME/work/