# GeoCities v1

A web3-native identity stack where one `*.geocities.eth` subdomain is
simultaneously a wallet, an `.eth` / IPFS browser, an encrypted email address,
and a publishable website.

This is a working prototype, not mocks — real mainnet ENS reads, real IPFS
fetches, real WebAuthn passkeys.

```
                     ┌───────────────────────────────────┐
                     │           web/  (Vite SPA)        │
                     │  Onboarding · Browser · Mail · Editor │
                     └───┬──────────────┬──────────────┬──┘
                         │              │              │
              passkey +  │              │              │  pin HTML
              smart acct │              │              │  (multipart)
                         ▼              ▼              ▼
                  ┌────────────┐  ┌──────────┐  ┌────────────┐
                  │  gateway/  │  │ mainnet  │  │  pinning/  │
                  │  Express   │  │   ENS +  │  │  Express + │
                  │  + ethers  │  │  IPFS gw │  │   w3up     │
                  └─────┬──────┘  └──────────┘  └──────┬─────┘
                        │                              │
            CCIP-Read   │                              │ web3.storage
            signed reply│                              ▼
                        ▼                       (real CIDv1 pin)
                  ┌────────────┐
                  │ contracts/ │  GeoCitiesResolver.sol
                  │  Foundry   │  (Sepolia, EIP-3668 wildcard resolver)
                  └────────────┘
```

## What's real / what's stubbed

| Piece                                   | Status                                  |
| --------------------------------------- | --------------------------------------- |
| Passkey creation                        | Real (WebAuthn / SimpleWebAuthn)        |
| Smart account address derivation        | Real (counterfactual CREATE2)           |
| ENS resolution for any `.eth`           | Real (mainnet via viem)                 |
| IPFS content fetch                      | Real (multi-gateway w/ failover)        |
| Site publish (HTML → IPFS)              | Real (web3.storage / w3up)              |
| Contenthash encoding                    | Real (`@ensdomains/content-hash`)       |
| `*.geocities.eth` resolution            | Real after Sepolia deploy + ENS link    |
| Smart account deployment                | Counterfactual until first user op      |
| EIP-1271 sigs on gateway writes         | **Stubbed** — gateway accepts a 65-byte zero placeholder in dev mode |
| XMTP integration                        | UI shape only — localStorage backed     |
| Real ETH transactions                   | None                                    |

## Repo layout

```
contracts/   Foundry — Solidity CCIP-Read resolver + deploy script
gateway/     Node + Express — off-chain CCIP signer + registration API
pinning/     Node + Express — IPFS pinning wrapper around w3up
web/         Vite + React + TypeScript SPA — the actual app
```

## Setup

Top-level monorepo uses npm workspaces.

```sh
npm install
```

Then per-package — see below. Each service has an `.env.example` you should
copy to `.env`.

### `contracts/` — Foundry

Install `foundry` (`curl -L https://foundry.paradigm.xyz | bash` then `foundryup`).

```sh
cd contracts
forge install foundry-rs/forge-std --no-commit
forge build
```

Set environment for deploy:

```
DEPLOYER_PK=0x...                  # funded Sepolia key
GATEWAY_SIGNER=0x...               # address derived from gateway/SIGNER_PK
GATEWAY_URL=https://your.gw/lookup/{sender}/{data}.json
SEPOLIA_RPC=https://sepolia.infura.io/v3/...
ETHERSCAN_KEY=...                  # optional
```

Deploy to Sepolia:

```sh
forge script script/DeployResolver.s.sol --rpc-url sepolia --broadcast
```

Copy the deployed address into `gateway/.env` as `RESOLVER_ADDRESS`. Then in
the ENS app on Sepolia, set the resolver of `geocities.eth` to that address.

### `gateway/` — CCIP-Read signer

```sh
cd gateway
cp .env.example .env
# fill in RESOLVER_ADDRESS and SIGNER_PK (any 32-byte hex; logs the address)
npm run dev
```

Logs the signer's address on startup. That address must equal `signer` on the
on-chain resolver — call `setSigner` if it doesn't.

Also exposes:

- `POST /register` — claim a label
- `POST /update-contenthash` — repoint a label to a new IPFS CID
- `GET  /record/:label` — used by the web app to check availability

For v1 the gateway accepts a 65-byte zero "signature" as a dev placeholder. See
"Path to mainnet" below — production must verify EIP-1271 against the user's
smart account.

### `pinning/` — IPFS pin proxy

```sh
cd pinning
cp .env.example .env
# follow the .env.example notes to set up a w3up space
npm run dev
```

The first request lazy-inits w3up. If w3 creds aren't ready yet, the server
still boots and pins fail with a clear error.

### `web/` — Vite SPA

```sh
cd web
cp .env.example .env
npm run dev
# open http://localhost:5173
```

The dev server runs at `localhost:5173`. Onboarding works against the gateway;
the Browser tab works against mainnet ENS without any local services.

## Path to mainnet

Seven things must happen before this stack is mainnet-ready:

1. **Contract audit.** `GeoCitiesResolver.sol` is unaudited. The signature
   verification path is small but security-critical.
2. **EIP-1271 on the gateway.** Replace the `0x00..00` placeholder by calling
   `isValidSignature` on the user's smart account from the gateway. Passkey →
   smart account ownership is the fiddly part.
3. **KMS-managed signer.** The gateway signing key currently lives in
   `process.env`. Move to AWS KMS / GCP KMS (or an HSM) and never let the raw
   key touch Node memory.
4. **Pinning durability.** w3up is fine for prototyping but each user's site
   should be pinned to ≥2 providers (web3.storage + Filebase or similar) and
   re-pinned on a schedule.
5. **Smart account deployment flow.** Today addresses are counterfactual; a
   bundler / paymaster needs to be wired in so the first user op deploys the
   account and is gas-sponsored.
6. **XMTP wire-up.** Mail is currently localStorage-backed. Replace the
   `setMessages` calls in `web/src/pages/Mail.tsx` with `client.conversations`
   from `@xmtp/browser-sdk`, with a session signer derived from the smart
   account.
7. **Test coverage.** Foundry tests for the resolver, integration tests for
   the gateway's signed responses (decode them with the real resolver in a
   forked-Sepolia test), and Playwright for the onboarding ceremony.

### Cost model

Per-user gas for *registration*: **$0**. CCIP-Read means subdomains live
off-chain and the only on-chain footprint is the parent `geocities.eth`
resolver record (a one-time deploy + set-resolver pair, paid by the operator).
The user pays gas only when they actually transact from their smart account.

## Verifying the Coinbase Smart Wallet factory

`web/src/lib/smartAccount.ts` pins addresses for the Coinbase Smart Wallet
factory + implementation. Before deploying anything mainnet-bound, verify the
current addresses against the [Coinbase Smart Wallet docs](https://github.com/coinbase/smart-wallet)
and replace the static math with a `factory.getAddress(owners, nonce)` call
on-chain. The local CREATE2 derivation will silently disagree with reality if
Coinbase ever changes the implementation slot.

## What this prototype intentionally skips

- No tests in this pass — README documents what to add.
- No mainnet deploys.
- No tracking / analytics.
- No real ETH movements (the "0.05 ETH attached" pill in the mail UI is cosmetic).
