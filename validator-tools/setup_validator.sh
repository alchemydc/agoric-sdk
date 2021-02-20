#!/bin/bash
set -x
. ./agoric.env

# get chain data
curl https://testnet.agoric.com/network-config > chain.json

# Set chain name to the correct value

if [ $(which jq) = "" ]; then
       echo "no jq found"
       echo "Please `sudo apt install jq` and re-run this script"
       exit(1)     
else
       echo "jq is installed"
fi

chainName=`jq -r .chainName < chain.json`
# Confirm value: should be something like agorictest-N.
echo $chainName

ag-chain-cosmos init --chain-id $chainName $moniker

mkdir -p $HOME/.ag-chain-cosmos/config

# Download the genesis file
curl https://testnet.agoric.com/genesis.json > $HOME/.ag-chain-cosmos/config/genesis.json 
# Reset the state of your validator.
ag-chain-cosmos unsafe-reset-all

# Set peers variable to the correct value
peers=`jq '.peers | join(",")' < chain.json`
# Confirm value, should be something like "077c58e4b207d02bbbb1b68d6e7e1df08ce18a8a@178.62.245.23:26656,..."
echo $peers
# Replace the persistent_peers value
sed -i -e "s/^persistent_peers *=.*/persistent_peers = $peers/" $HOME/.ag-chain-cosmos/config/config.toml
# Replace the timeout_commit value with 5s (previous was 2s)
sed -i -e 's/^\(timeout_commit *=\).*/\1 "5s"/' $HOME/.ag-chain-cosmos/config/config.toml

# configure systemd
sudo tee <<EOF >/dev/null /etc/systemd/system/ag-chain-cosmos.service
[Unit]
Description=Agoric Cosmos daemon
After=network-online.target

[Service]
User=$USER
Environment=PATH=$HOME/.nvm/versions/node/v12.20.2/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games:/usr/local/go/bin:$HOME/go/bin
ExecStart=$HOME/go/bin/ag-chain-cosmos start --log_level=warn
Restart=on-failure
RestartSec=3
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF


# Start the node
sudo systemctl enable ag-chain-cosmos
sudo systemctl start ag-chain-cosmos

# see sync status

#ag-cosmos-helper status 2>&1 | jq .SyncInfo
ag-cosmos-helper status 2>&1 | jq .


# run only once to create validator keys
# Replace <your-key-name> with a name for your operator key that you will remember
ag-cosmos-helper keys add $keyName

# don't forget to securely store the mnemonics etc.

# To see a list of wallets on your node
ag-cosmos-helper keys list

ag-cosmos-helper query bank balances `ag-cosmos-helper keys show -a $keyName`


# Set the chainName value again
chainName=`curl https://testnet.agoric.com/network-config | jq -r .chainName`
# Confirm value: should be something like agorictest-6
echo $chainName
# Replace <key_name> with the key you created previously
ag-cosmos-helper tx staking create-validator \
  --amount=50000000uagstake \
  --broadcast-mode=block \
  --pubkey=$agoricvalconspub1address \
  --moniker=$moniker \
  --website='https://zanshindojo.org' \
  --details='the quieter you are, the more you are able to hear' \
  --commission-rate="0.10" \
  --commission-max-rate="0.20" \
  --commission-max-change-rate="0.01" \
  --min-self-delegation="1" \
  --from=$keyName \
  --chain-id=$chainName \
  --gas=auto \
  --gas-adjustment=1.4

