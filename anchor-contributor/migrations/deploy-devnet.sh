#!/bin/bash

set -euo pipefail

solana config set --url devnet

# WALLET must be set
WALLET="/home/abdullah/.config/solana/keypair.json"
ls $WALLET

# and PROGRAM_ID
PROGRAM_KEY="/home/abdullah/Workspace/codora-icco/wormhole-icco/anchor-contributor/target/deploy/anchor_contributor-keypair.json"
ls $PROGRAM_KEY

. devnet.env
cp -i $PROGRAM_KEY target/deploy/anchor_contributor-keypair.json
anchor build --provider.cluster devnet
solana program deploy /home/abdullah/Workspace/codora-icco/wormhole-icco/anchor-contributor/target/deploy/anchor_contributor.so -k $WALLET

# create custodian if it doesn't exist
ts-node migrations/create-devnet-custodian.ts